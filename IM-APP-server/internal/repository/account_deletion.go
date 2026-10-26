package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AccountDeletionRepo 账号注销的数据访问层。
//
// 关键约束：注销采用**物理删除** users 行（users.phone / users.phone_e164 是
// 唯一键，删行后手机号自然释放，用户可同号重新注册）。因此审计表不能建指向
// users 的外键，审计记录必须自己带齐留痕字段。
type AccountDeletionRepo struct {
	DB *pgxpool.Pool
}

// AccountDeletionRecord 写入 account_deletions 的审计记录。
// 只存哈希，不存任何明文个人数据。
type AccountDeletionRecord struct {
	UserID              string
	PhoneE164Hash       string
	NicknameHash        string
	CountryCode         string
	RequestIP           string
	RequestUserAgent    string
	VerificationMethod  string
	Summary             models.AccountDeletionSummary
	IMCleanupStatus     string
	StorageCleanupStatus string
}

// Summary 采集注销影响范围快照（好友/群/收藏/文件），用于前端展示与审计留痕。
// 各计数独立取数，单个失败不影响整体，返回已成功采集的部分。
func (r *AccountDeletionRepo) Summary(ctx context.Context, userID string) (models.AccountDeletionSummary, error) {
	var summary models.AccountDeletionSummary
	_ = r.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM friendships WHERE user_id=$1::uuid`, userID,
	).Scan(&summary.FriendCount)
	_ = r.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM group_members WHERE user_id=$1::uuid`, userID,
	).Scan(&summary.GroupCount)
	_ = r.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM groups WHERE owner_id=$1::uuid AND COALESCE(status,'active')='active'`, userID,
	).Scan(&summary.OwnedGroupCount)
	_ = r.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM favorites WHERE user_id=$1::uuid`, userID,
	).Scan(&summary.FavoriteCount)
	_ = r.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM files WHERE owner_id=$1::uuid`, userID,
	).Scan(&summary.FileCount)
	return summary, nil
}

// OwnedActiveGroups 列出用户仍担任群主的活跃群 —— 这是注销的阻碍项。
func (r *AccountDeletionRepo) OwnedActiveGroups(ctx context.Context, userID string) ([]models.AccountDeletionBlocker, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, COALESCE(public_id,''), name
		FROM groups
		WHERE owner_id=$1::uuid AND COALESCE(status,'active')='active'
		ORDER BY created_at`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blockers []models.AccountDeletionBlocker
	for rows.Next() {
		var b models.AccountDeletionBlocker
		if err := rows.Scan(&b.GroupID, &b.GroupPublicID, &b.GroupName); err != nil {
			return nil, err
		}
		b.Code = "group_owner"
		b.Action = "transfer"
		b.Message = fmt.Sprintf("你仍是群「%s」的群主，请先转让群主或解散该群", b.GroupName)
		blockers = append(blockers, b)
	}
	return blockers, rows.Err()
}

// Insert 写入审计记录并返回其 ID。
func (r *AccountDeletionRepo) Insert(ctx context.Context, rec AccountDeletionRecord) (string, error) {
	summaryJSON, err := json.Marshal(rec.Summary)
	if err != nil {
		summaryJSON = []byte("{}")
	}
	var id string
	err = r.DB.QueryRow(ctx, `
		INSERT INTO account_deletions(
			user_id, phone_e164_hash, nickname_hash, country_code,
			request_ip, request_user_agent, verification_method,
			summary, im_cleanup_status, storage_cleanup_status, created_at
		) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
		RETURNING id::text`,
		rec.UserID, rec.PhoneE164Hash, rec.NicknameHash, rec.CountryCode,
		rec.RequestIP, rec.RequestUserAgent, rec.VerificationMethod,
		string(summaryJSON), rec.IMCleanupStatus, rec.StorageCleanupStatus, time.Now(),
	).Scan(&id)
	return id, err
}

// DeleteUser 物理删除 users 行，关联数据靠外键级联清理。
//
// groups.owner_id 故意保持 NO ACTION：若上层校验被绕过、用户仍是群主，
// 这条外键会让删除直接失败，避免整群数据被连带删除。
func (r *AccountDeletionRepo) DeleteUser(ctx context.Context, userID string) error {
	_, err := r.DB.Exec(ctx, `DELETE FROM users WHERE id=$1::uuid`, userID)
	return err
}

// DeleteAtomically 在单个事务内完成「写审计 + 物理删除用户」。
//
// 两者必须同生共死：
//   - 只写审计没删人 → 用户以为注销了，账号却还在（合规事故）
//   - 只删人没留痕 → 无法举证已按用户要求删除数据
//
// 任一步失败整体回滚，调用方据此向用户返回失败而不是「半注销」。
func (r *AccountDeletionRepo) DeleteAtomically(ctx context.Context, rec AccountDeletionRecord) (string, error) {
	summaryJSON, err := json.Marshal(rec.Summary)
	if err != nil {
		summaryJSON = []byte("{}")
	}

	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO account_deletions(
			user_id, phone_e164_hash, nickname_hash, country_code,
			request_ip, request_user_agent, verification_method,
			summary, im_cleanup_status, storage_cleanup_status, created_at
		) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
		RETURNING id::text`,
		rec.UserID, rec.PhoneE164Hash, rec.NicknameHash, rec.CountryCode,
		rec.RequestIP, rec.RequestUserAgent, rec.VerificationMethod,
		string(summaryJSON), rec.IMCleanupStatus, rec.StorageCleanupStatus, time.Now(),
	).Scan(&id); err != nil {
		return "", err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id=$1::uuid`, rec.UserID); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

// cleanupSettled 判断某项清理是否已到终态（不再需要后台补偿）。
func cleanupSettled(status string) bool {
	switch status {
	case "done", "failed", "skipped":
		return true
	}
	return false
}

// MarkCleanup 更新旁路清理（IM / 对象存储）的结果。
// 只在审计记录上打标，绝不影响已完成的删除。
func (r *AccountDeletionRepo) MarkCleanup(ctx context.Context, recordID, imStatus, imErr, storageStatus, storageErr string) error {
	// 完成标记在 Go 侧算好再传参：同一个占位符既用于列赋值（varchar）又用于
	// IN 列表（text）时，PostgreSQL 会报 inconsistent types deduced for parameter，
	// 整条 UPDATE 失败、状态永远停在 pending。
	completed := cleanupSettled(imStatus) && cleanupSettled(storageStatus)
	_, err := r.DB.Exec(ctx, `
		UPDATE account_deletions
		SET im_cleanup_status=$2, im_cleanup_error=$3,
			storage_cleanup_status=$4, storage_cleanup_error=$5,
			completed_at = CASE WHEN $6 THEN NOW() ELSE completed_at END
		WHERE id=$1::uuid`,
		recordID, imStatus, imErr, storageStatus, storageErr, completed,
	)
	return err
}
