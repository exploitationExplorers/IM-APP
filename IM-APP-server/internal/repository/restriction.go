package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RestrictionRepo 用户登录/发信限制（表：user_restrictions；admin 写入，server 强制检查）
type RestrictionRepo struct{ DB *pgxpool.Pool }

// SetRestriction 写/更新限制（UPSERT）
func (r *RestrictionRepo) SetRestriction(ctx context.Context, userID, restrType string, banned bool, until *time.Time, reason, operatorID string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO user_restrictions(user_id, type, banned, until, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5,$6::uuid)
		ON CONFLICT (user_id, type) DO UPDATE SET
			banned=$3, until=$4, reason=$5, operator_id=$6::uuid, created_at=NOW()`,
		userID, restrType, banned, until, reason, operatorID)
	return err
}

// UserRestrictions 查账号状态 + login/message 限制（供登录/发消息检查；until 过期视为未限制）
func (r *RestrictionRepo) UserRestrictions(ctx context.Context, userID string) (status string, loginBanned, messageBanned bool, err error) {
	status = "active"
	if err := r.DB.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM users WHERE id=$1::uuid`, userID).Scan(&status); err != nil {
		return status, false, false, err
	}
	rows, err := r.DB.Query(ctx, `SELECT type, banned, until FROM user_restrictions WHERE user_id=$1::uuid`, userID)
	if err != nil {
		return status, loginBanned, messageBanned, err
	}
	defer rows.Close()
	now := time.Now()
	for rows.Next() {
		var t string
		var banned bool
		var until *time.Time
		if err := rows.Scan(&t, &banned, &until); err != nil {
			return status, loginBanned, messageBanned, err
		}
		if !banned || (until != nil && now.After(*until)) {
			continue
		}
		switch t {
		case "login":
			loginBanned = true
		case "message":
			messageBanned = true
		}
	}
	return status, loginBanned, messageBanned, nil
}

// SetUserStatus 更新账号状态；banned 时撤销全部会话（强制下线）
func (r *RestrictionRepo) SetUserStatus(ctx context.Context, userID, status, reason, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE users SET status=$2, updated_at=NOW() WHERE id=$1::uuid`, userID, status); err != nil {
		return err
	}
	if status == "banned" {
		if _, err := tx.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// RevokeSessions 强制下线（撤销该用户全部会话）
func (r *RestrictionRepo) RevokeSessions(ctx context.Context, userID string) error {
	_, err := r.DB.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID)
	return err
}
