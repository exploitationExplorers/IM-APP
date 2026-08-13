package repository

import (
	"context"

	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DataRepo 管理后台对 APP 数据与运营配置的查询/操作
type DataRepo struct{ DB *pgxpool.Pool }

// ===== 用户管理 =====
func (r *DataRepo) ListUsers(ctx context.Context, keyword string, limit, offset int) ([]models.AdminUser, error) {
	q := `
		SELECT u.id::text, u.phone_e164, u.country_code, COALESCE(u.public_id,''), u.nickname,
		       u.avatar, COALESCE(u.status,'active'), u.created_at,
		       (SELECT COUNT(*) FROM friendships f WHERE f.user_id=u.id),
		       (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id=u.id)
		FROM users u`
	args := []any{limit, offset}
	if keyword != "" {
		q += ` WHERE u.public_id = $3 OR u.phone_e164 = $3 OR u.id::text = $3`
		args = append(args, keyword)
	}
	q += ` ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.AdminUser, 0)
	for rows.Next() {
		var u models.AdminUser
		if err := rows.Scan(&u.ID, &u.PhoneMasked, &u.CountryCode, &u.PublicID, &u.Nickname,
			&u.Avatar, &u.Status, &u.CreatedAt, &u.FriendCount, &u.GroupCount); err != nil {
			return nil, err
		}
		list = append(list, u)
	}
	return list, nil
}

func (r *DataRepo) GetUserDetail(ctx context.Context, userID string) (*models.AdminUserDetail, error) {
	var u models.AdminUserDetail
	err := r.DB.QueryRow(ctx, `
		SELECT u.id::text, u.phone_e164, u.country_code, COALESCE(u.public_id,''), u.nickname,
		       u.avatar, COALESCE(u.status,'active'), u.created_at, COALESCE(u.bio,''),
		       (SELECT COUNT(*) FROM friendships f WHERE f.user_id=u.id),
		       (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id=u.id),
		       (SELECT COUNT(*) FROM reports rp WHERE rp.target_id = u.id::text)
		FROM users u WHERE u.id=$1::uuid`, userID,
	).Scan(&u.ID, &u.PhoneMasked, &u.CountryCode, &u.PublicID, &u.Nickname,
		&u.Avatar, &u.Status, &u.CreatedAt, &u.Bio, &u.FriendCount, &u.GroupCount, &u.ReportCount)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UpdateUserStatus 更新用户状态；status=banned 时同时撤销其登录会话
func (r *DataRepo) UpdateUserStatus(ctx context.Context, userID, status string) error {
	_, err := r.DB.Exec(ctx, `UPDATE users SET status=$2, updated_at=NOW() WHERE id=$1::uuid`, userID, status)
	if err == nil && status == "banned" {
		_, _ = r.DB.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID)
	}
	return err
}

func (r *DataRepo) ListUserReports(ctx context.Context, userID string, limit, offset int) ([]models.ReportRecord, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT rp.id::text, rp.target_type, COALESCE(rr.reason,''), COALESCE(rp.description,''),
		       COALESCE(rp.status,'pending'), rp.created_at
		FROM reports rp LEFT JOIN report_reasons rr ON rr.id = rp.reason_id
		WHERE rp.target_id=$1::text ORDER BY rp.created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.ReportRecord, 0)
	for rows.Next() {
		var rp models.ReportRecord
		if err := rows.Scan(&rp.ID, &rp.TargetType, &rp.Reason, &rp.Description, &rp.Status, &rp.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, rp)
	}
	return list, nil
}

// ===== 群组管理 =====
func (r *DataRepo) ListGroups(ctx context.Context, keyword string, limit, offset int) ([]models.AdminGroup, error) {
	q := `
		SELECT g.id::text, g.name, g.avatar, g.owner_id::text,
		       (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
		       COALESCE(g.status,'normal'), g.created_at
		FROM groups g`
	args := []any{limit, offset}
	if keyword != "" {
		q += ` WHERE g.name ILIKE '%'||$3||'%' OR g.id::text=$3`
		args = append(args, keyword)
	}
	q += ` ORDER BY g.created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.AdminGroup, 0)
	for rows.Next() {
		var g models.AdminGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount, &g.Status, &g.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	return list, nil
}

func (r *DataRepo) ListGroupMembers(ctx context.Context, groupID string) ([]models.AdminGroupMember, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT gm.user_id::text, COALESCE(u.nickname,''), COALESCE(gm.role,'member'),
		       COALESCE(gm.muted_until::text,''), gm.joined_at::text
		FROM group_members gm JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.AdminGroupMember, 0)
	for rows.Next() {
		var m models.AdminGroupMember
		if err := rows.Scan(&m.UserID, &m.Nickname, &m.Role, &m.MutedUntil, &m.JoinedAt); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, nil
}

func (r *DataRepo) UpdateGroupStatus(ctx context.Context, groupID, status string) error {
	_, err := r.DB.Exec(ctx, `UPDATE groups SET status=$2 WHERE id=$1::uuid`, groupID, status)
	return err
}

func (r *DataRepo) MuteGroupAll(ctx context.Context, groupID string, muted bool) error {
	_, err := r.DB.Exec(ctx, `UPDATE groups SET all_muted=$2 WHERE id=$1::uuid`, groupID, muted)
	return err
}

// ListGroupRecallLogs 群管理撤回记录（基于 messages.recalled_at）
func (r *DataRepo) ListGroupRecallLogs(ctx context.Context, groupID string, limit, offset int) ([]models.RecallLog, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT m.id::text, c.conversation_id::text, COALESCE(u.nickname,''), m.recalled_by::text,
		       COALESCE(m.content,''), m.recalled_at
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id AND c.id=$1::uuid
		JOIN users u ON u.id = m.recalled_by
		WHERE m.recalled_at IS NOT NULL
		ORDER BY m.recalled_at DESC LIMIT $2 OFFSET $3`, groupID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.RecallLog, 0)
	for rows.Next() {
		var rl models.RecallLog
		if err := rows.Scan(&rl.ID, &rl.GroupID, &rl.Operator, &rl.MessageID, &rl.Reason, &rl.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, rl)
	}
	return list, nil
}

// ===== 转发任务 =====
func (r *DataRepo) ListForwardTasks(ctx context.Context, status string, limit, offset int) ([]models.AdminForwardTask, error) {
	q := `SELECT id::text, user_id::text, source_message_id, status,
		      target_count, success_count, failed_count, skipped_count, created_at, finished_at
	      FROM forward_tasks`
	args := []any{limit, offset}
	if status != "" {
		q += ` WHERE status=$3`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.AdminForwardTask, 0)
	for rows.Next() {
		var t models.AdminForwardTask
		if err := rows.Scan(&t.ID, &t.UserID, &t.SourceMsgID, &t.Status,
			&t.TargetCount, &t.SuccessCount, &t.FailedCount, &t.SkippedCount, &t.CreatedAt, &t.FinishedAt); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, nil
}

// ===== 短信记录 =====
func (r *DataRepo) ListSmsLogs(ctx context.Context, limit, offset int) ([]models.SmsLog, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id, phone_e164, country_code, scene, status, error_code, created_at
		FROM sms_send_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.SmsLog, 0)
	for rows.Next() {
		var s models.SmsLog
		if err := rows.Scan(&s.ID, &s.PhoneE164, &s.CountryCode, &s.Scene, &s.Status, &s.ErrorCode, &s.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	return list, nil
}

// ===== 运营配置：APP 版本 / 协议 / 敏感词 =====
func (r *DataRepo) ListAppVersions(ctx context.Context) ([]models.AppVersion, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, platform, version, description, download_url, force_upgrade, created_at
		FROM app_versions ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.AppVersion, 0)
	for rows.Next() {
		var v models.AppVersion
		if err := rows.Scan(&v.ID, &v.Platform, &v.Version, &v.Description, &v.DownloadURL, &v.ForceUpgrade, &v.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, nil
}

func (r *DataRepo) CreateAppVersion(ctx context.Context, v models.AppVersion) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO app_versions(platform, version, description, download_url, force_upgrade)
		VALUES($1,$2,$3,$4,$5)`, v.Platform, v.Version, v.Description, v.DownloadURL, v.ForceUpgrade)
	return err
}

func (r *DataRepo) ListPolicies(ctx context.Context) ([]models.AppPolicy, error) {
	rows, err := r.DB.Query(ctx, `SELECT id::text, type, title, content, version, created_at FROM app_policies ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.AppPolicy, 0)
	for rows.Next() {
		var p models.AppPolicy
		if err := rows.Scan(&p.ID, &p.Type, &p.Title, &p.Content, &p.Version, &p.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, nil
}

func (r *DataRepo) SavePolicy(ctx context.Context, p models.AppPolicy) error {
	if p.ID == "" {
		_, err := r.DB.Exec(ctx, `
			INSERT INTO app_policies(type, title, content, version) VALUES($1,$2,$3,$4)`,
			p.Type, p.Title, p.Content, p.Version)
		return err
	}
	_, err := r.DB.Exec(ctx, `
		UPDATE app_policies SET title=$2, content=$3, version=$4 WHERE id=$1::uuid`,
		p.ID, p.Title, p.Content, p.Version)
	return err
}

func (r *DataRepo) ListSensitiveWords(ctx context.Context) ([]models.SensitiveWord, error) {
	rows, err := r.DB.Query(ctx, `SELECT id::text, word, category, status, created_at FROM sensitive_words ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.SensitiveWord, 0)
	for rows.Next() {
		var w models.SensitiveWord
		if err := rows.Scan(&w.ID, &w.Word, &w.Category, &w.Status, &w.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, w)
	}
	return list, nil
}

func (r *DataRepo) CreateSensitiveWord(ctx context.Context, w models.SensitiveWord) error {
	_, err := r.DB.Exec(ctx, `INSERT INTO sensitive_words(word, category, status) VALUES($1,$2,$3)`, w.Word, w.Category, w.Status)
	return err
}

func (r *DataRepo) DeleteSensitiveWord(ctx context.Context, id string) error {
	_, err := r.DB.Exec(ctx, `DELETE FROM sensitive_words WHERE id=$1::uuid`, id)
	return err
}

// ===== 国家/地区启停 =====
func (r *DataRepo) ListCountries(ctx context.Context) ([]models.Country, error) {
	rows, err := r.DB.Query(ctx, `SELECT code, dial_code, cn_name, en_name, enabled FROM countries ORDER BY sort_order, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Country, 0)
	for rows.Next() {
		var c models.Country
		if err := rows.Scan(&c.Code, &c.DialCode, &c.CNName, &c.ENName, &c.Enabled); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, nil
}

func (r *DataRepo) UpdateCountry(ctx context.Context, code string, enabled bool) error {
	_, err := r.DB.Exec(ctx, `UPDATE countries SET enabled=$2 WHERE code=$1`, code, enabled)
	return err
}

// ===== 群详情与公共设置 =====
func (r *DataRepo) GetGroupDetail(ctx context.Context, groupID string) (*models.AdminGroupDetail, error) {
	var g models.AdminGroupDetail
	err := r.DB.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.avatar, g.owner_id::text,
		       (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
		       COALESCE(g.status,'normal'), g.created_at,
		       COALESCE(g.join_mode,'direct'), COALESCE(g.allow_member_add_friend,true),
		       COALESCE(g.all_muted,false), COALESCE(g.announcement,'')
		FROM groups g WHERE g.id=$1::uuid`, groupID,
	).Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount, &g.Status, &g.CreatedAt,
		&g.JoinMode, &g.AllowMemberAddFriend, &g.AllMuted, &g.Announcement)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *DataRepo) UpdateGroupSettings(ctx context.Context, groupID string, s models.UpdateGroupSettingsRequest) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE groups SET
			join_mode = COALESCE($2, join_mode),
			allow_member_add_friend = COALESCE($3, allow_member_add_friend),
			all_muted = COALESCE($4, all_muted)
		WHERE id=$1::uuid`,
		groupID, s.JoinMode, s.AllowMemberAddFriend, s.AllMuted)
	return err
}
