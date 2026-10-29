package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrFriendSourceRequired = errors.New("verified friend source required")
	ErrFriendRateLimited    = errors.New("friend request rate limited")
)

const (
	FriendSourceTTL         = 30 * time.Minute
	FriendRequestsPerMinute = 20
	FriendRequestsPerDay    = 100
)

type FriendSecurityRepo struct{ DB *pgxpool.Pool }

// Grant 只能在服务端验证聊天号或二维码后调用，不能由客户端直接签发。
func (r *FriendSecurityRepo) Grant(ctx context.Context, fromID, toID, source string) error {
	if source != "public_id" && source != "user_qrcode" {
		return ErrFriendSourceRequired
	}
	_, err := r.DB.Exec(ctx, `
		INSERT INTO friend_source_grants(from_user, to_user, source, expires_at, granted_at)
		VALUES($1::uuid, $2::uuid, $3, clock_timestamp() + $4 * interval '1 second', clock_timestamp())
		ON CONFLICT (from_user, to_user, source) DO UPDATE
		SET expires_at=EXCLUDED.expires_at, granted_at=EXCLUDED.granted_at`, fromID, toID, source, int(FriendSourceTTL.Seconds()))
	return err
}

// Resolve 不信任客户端的来源声明；未声明来源时兼容旧客户端，采用最近的有效授权。
func (r *FriendSecurityRepo) Resolve(ctx context.Context, fromID, toID, source string) (string, error) {
	var verified string
	err := r.DB.QueryRow(ctx, `
		SELECT source FROM friend_source_grants
		WHERE from_user=$1::uuid AND to_user=$2::uuid
		  AND ($3='' OR source=$3) AND expires_at > clock_timestamp()
		ORDER BY granted_at DESC, source LIMIT 1`, fromID, toID, source).Scan(&verified)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrFriendSourceRequired
	}
	return verified, err
}

// Take 使用同一账号的事务锁串行化配额消费；两条申请入口共用滑动窗口。
// 先消费额度再创建申请，后续写入失败也占额度，避免失败重试绕过限制。
func (r *FriendSecurityRepo) Take(ctx context.Context, userID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 713005))`, userID); err != nil {
		return err
	}
	var minuteCount, dayCount int
	var now time.Time
	// 获取锁之后再取时间，排队等待不会缩短窗口。
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return err
	}
	if err = tx.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE created_at > $2::timestamptz - interval '1 minute'), COUNT(*)
		FROM friend_request_attempts WHERE user_id=$1::uuid AND created_at > $2::timestamptz - interval '24 hours'`, userID, now).Scan(&minuteCount, &dayCount); err != nil {
		return err
	}
	if minuteCount >= FriendRequestsPerMinute || dayCount >= FriendRequestsPerDay {
		return ErrFriendRateLimited
	}
	if _, err = tx.Exec(ctx, `DELETE FROM friend_request_attempts WHERE user_id=$1::uuid AND created_at <= $2::timestamptz - interval '24 hours'`, userID, now); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO friend_request_attempts(user_id, created_at) VALUES($1::uuid, $2)`, userID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
