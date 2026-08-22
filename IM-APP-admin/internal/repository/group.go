package repository

import (
	"context"

	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5"
)

// ===== 群组管理（清单 04） =====

func normalizeGroupStatus(s string) string {
	if s == "active" {
		return "normal"
	}
	return s
}

const groupSelect = `
	SELECT g.id::text, g.name, g.avatar, g.owner_id::text, COALESCE(ou.nickname,''),
	       (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
	       COALESCE(g.status,'active'), COALESCE(g.all_muted,false), g.created_at
	FROM groups g LEFT JOIN users ou ON ou.id=g.owner_id`

func scanGroup(row pgx.Row) (models.AppGroup, error) {
	var g models.AppGroup
	err := row.Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.OwnerName,
		&g.MemberCount, &g.Status, &g.AllMuted, &g.CreatedAt)
	g.Status = normalizeGroupStatus(g.Status)
	return g, err
}

func (r *DataRepo) ListGroups(ctx context.Context, keyword, status string, limit, offset int) ([]models.AppGroup, int64, error) {
	where := ""
	args := make([]any, 0)
	if keyword != "" {
		args = append(args, "%"+keyword+"%")
		where += " AND (g.name ILIKE $" + itoa(len(args)) + " OR g.id::text=$" + itoa(len(args)) + ")"
	}
	if status != "" && status != "all" {
		// 前端用归一化业务状态（normal/muted/banned/dissolved），需映射到数据库实际查询条件：
		// groups.status 只存 active/dismissed；全员禁言由 all_muted 字段表示，不在 status 中。
		switch status {
		case "normal":
			where += " AND g.status='active'"
		case "dissolved":
			where += " AND g.status='dismissed'"
		case "muted":
			where += " AND COALESCE(g.all_muted,false)=true"
		default:
			args = append(args, status)
			where += " AND g.status=$" + itoa(len(args))
		}
	}
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM groups g WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, groupSelect+" WHERE 1=1"+where+
		" ORDER BY g.created_at DESC LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.AppGroup, 0)
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, g)
	}
	return out, total, nil
}

func (r *DataRepo) GetGroupDetail(ctx context.Context, groupID string) (*models.AppGroupDetail, error) {
	var g models.AppGroupDetail
	err := r.DB.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.avatar, g.owner_id::text, COALESCE(ou.nickname,''),
		       (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
		       COALESCE(g.status,'active'), COALESCE(g.all_muted,false), g.created_at,
		       COALESCE(g.join_mode,'open'), COALESCE(g.allow_member_add_friend,true),
		       COALESCE(g.announcement,''),
		       COALESCE(g.max_members,200),
		       g.dissolved_at, COALESCE(g.dissolved_by_admin_id::text,''), COALESCE(g.dissolve_reason,'')
		FROM groups g LEFT JOIN users ou ON ou.id=g.owner_id WHERE g.id=$1::uuid`, groupID,
	).Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.OwnerName, &g.MemberCount, &g.Status,
		&g.AllMuted, &g.CreatedAt, &g.JoinMode, &g.AllowMemberAddFriend, &g.Announcement,
		&g.MaxMembers, &g.DissolvedAt, &g.DissolvedByAdminId, &g.DissolveReason)
	if err != nil {
		return nil, err
	}
	g.Status = normalizeGroupStatus(g.Status)
	return &g, nil
}

func (r *DataRepo) ListGroupMembers(ctx context.Context, groupID, keyword string, limit, offset int) ([]models.AppGroupMember, int64, error) {
	pattern := "%" + keyword + "%"
	var total int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM group_members gm JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid AND ($2='' OR u.nickname ILIKE $3 OR gm.user_id::text=$2)`, groupID, keyword, pattern).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT gm.user_id::text, COALESCE(u.nickname,''), COALESCE(gm.role,'member'),
		       gm.muted_until, gm.joined_at
		FROM group_members gm JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid AND ($2='' OR u.nickname ILIKE $3 OR gm.user_id::text=$2)
		ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at
		LIMIT $4 OFFSET $5`, groupID, keyword, pattern, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.AppGroupMember, 0)
	for rows.Next() {
		var m models.AppGroupMember
		if err := rows.Scan(&m.UserID, &m.Nickname, &m.Role, &m.MutedUntil, &m.JoinedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, nil
}

// logGroupStatus 记录群状态变更到 group_status_logs（不扩展 groups 表）
func (r *DataRepo) logGroupStatus(ctx context.Context, groupID, toStatus, reason, operatorID string) error {
	var from string
	_ = r.DB.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM groups WHERE id=$1::uuid`, groupID).Scan(&from)
	_, err := r.DB.Exec(ctx, `
		INSERT INTO group_status_logs(group_id, from_status, to_status, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5::uuid)`, groupID, normalizeGroupStatus(from), toStatus, reason, operatorID)
	return err
}

// LogGroupMute 记录群禁言审计（禁言动作已由 server 内部接口执行并同步 OpenIM；本方法只写 group_status_logs）
func (r *DataRepo) LogGroupMute(ctx context.Context, groupID string, muted bool, reason, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	to := "normal"
	if muted {
		to = "muted"
	}
	if err := r.logGroupStatusTx(ctx, tx, groupID, to, reason, operatorID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// LogGroupDissolve 记录群解散审计（解散动作已由 server 内部接口执行并同步 OpenIM；本方法只写 group_status_logs）
// fromStatus 由调用方在解散动作前快照传入（否则 server 改库后读到的是 dismissed，from 会错误地等于 to）
func (r *DataRepo) LogGroupDissolve(ctx context.Context, groupID, fromStatus, reason, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := r.logGroupStatusFromTx(ctx, tx, groupID, fromStatus, "dismissed", reason, operatorID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *DataRepo) logGroupStatusTx(ctx context.Context, tx pgx.Tx, groupID, toStatus, reason, operatorID string) error {
	var from string
	_ = tx.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM groups WHERE id=$1::uuid`, groupID).Scan(&from)
	_, err := tx.Exec(ctx, `
		INSERT INTO group_status_logs(group_id, from_status, to_status, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5::uuid)`, groupID, normalizeGroupStatus(from), toStatus, reason, operatorID)
	return err
}

// logGroupStatusFromTx 以显式 fromStatus 写入群状态变更审计（from 由调用方在动作前快照，
// 避免动作改库后读到的 from 已是新状态，如解散后读到 dismissed）
func (r *DataRepo) logGroupStatusFromTx(ctx context.Context, tx pgx.Tx, groupID, fromStatus, toStatus, reason, operatorID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO group_status_logs(group_id, from_status, to_status, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5::uuid)`, groupID, fromStatus, toStatus, reason, operatorID)
	return err
}

// GetGroupStatus 读取群当前状态（归一化后：normal|muted|banned|dismissed），供解散等动作前快照审计用
func (r *DataRepo) GetGroupStatus(ctx context.Context, groupID string) (string, error) {
	var s string
	err := r.DB.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM groups WHERE id=$1::uuid`, groupID).Scan(&s)
	if err != nil {
		return "", err
	}
	return normalizeGroupStatus(s), nil
}

func (r *DataRepo) ListGroupReports(ctx context.Context, groupID string, limit, offset int) ([]models.Report, int64, error) {
	var total int64
	_ = r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM reports WHERE target_type='group' AND target_id=$1::text`, groupID).Scan(&total)
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, report_no, COALESCE(reporter_id::text,''), target_type, target_id,
		       reason_text, description, status, COALESCE(assignee_id::text,''),
		       COALESCE(conclusion,''), COALESCE(action_taken,''), created_at, updated_at
		FROM reports WHERE target_type='group' AND target_id=$1::text
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, groupID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.Report, 0)
	for rows.Next() {
		rp, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, rp)
	}
	return out, total, nil
}

// RecallMessage 管理撤回：消息表打撤回标记（024 扩展列）+ 写撤回审计（不物理删除消息）
func (r *DataRepo) RecallMessage(ctx context.Context, groupID, messageID, reason, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// 消息表打撤回标记（依赖 server 024 migration 的 messages.recalled_at/recalled_by）
	if _, err := tx.Exec(ctx, `
		UPDATE messages SET recalled_at=NOW(), recalled_by=$2::uuid
		WHERE id=$1::uuid`, messageID, operatorID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO message_recall_logs(message_id, group_id, operator_type, operator_id, reason)
		VALUES($1::uuid,$2::uuid,'admin',$3::uuid,$4)`, messageID, groupID, operatorID, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// LogMessageRecall 记录撤回审计（撤回动作已由 server 内部接口执行 + OpenIM 撤回；本方法只写 message_recall_logs）
func (r *DataRepo) LogMessageRecall(ctx context.Context, groupID, messageID, reason, operatorID string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO message_recall_logs(message_id, group_id, operator_type, operator_id, reason)
		VALUES($1::uuid,$2::uuid,'admin',$3::uuid,$4)`, messageID, groupID, operatorID, reason)
	return err
}

func (r *DataRepo) ListGroupRecallLogs(ctx context.Context, groupID string, limit, offset int) ([]models.RecallLog, int64, error) {
	var total int64
	_ = r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM message_recall_logs WHERE group_id=$1::uuid`, groupID).Scan(&total)
	rows, err := r.DB.Query(ctx, `
		SELECT rl.id, rl.message_id::text, rl.group_id::text, rl.operator_type, rl.reason, rl.created_at,
		       COALESCE(a.nickname,'')
		FROM message_recall_logs rl
		LEFT JOIN admin_users a ON a.id = rl.operator_id
		WHERE rl.group_id=$1::uuid
		ORDER BY rl.created_at DESC LIMIT $2 OFFSET $3`, groupID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.RecallLog, 0)
	for rows.Next() {
		var l models.RecallLog
		if err := rows.Scan(&l.ID, &l.MessageID, &l.GroupID, &l.OperatorType, &l.Reason, &l.CreatedAt, &l.OperatorName); err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, total, nil
}

// ListGroupStatusLogs 群状态变更记录（分页，按时间倒序）。
// operator_id 有两种来源：管理端操作为 admin_users.id，用户端（群主解散）为 users.id，
// 双 JOIN 取名并推导 operatorType。
func (r *DataRepo) ListGroupStatusLogs(ctx context.Context, groupID string, limit, offset int) ([]models.GroupStatusLog, int64, error) {
	var total int64
	_ = r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM group_status_logs WHERE group_id=$1::uuid`, groupID).Scan(&total)
	rows, err := r.DB.Query(ctx, `
		SELECT gsl.id, gsl.group_id::text, gsl.from_status, gsl.to_status, gsl.reason,
		       COALESCE(gsl.operator_id::text,''),
		       COALESCE(u.nickname, a.nickname, ''),
		       CASE WHEN a.id IS NOT NULL THEN 'admin' WHEN u.id IS NOT NULL THEN 'user' ELSE '' END,
		       gsl.created_at
		FROM group_status_logs gsl
		LEFT JOIN users u       ON u.id = gsl.operator_id
		LEFT JOIN admin_users a ON a.id = gsl.operator_id
		WHERE gsl.group_id=$1::uuid
		ORDER BY gsl.created_at DESC LIMIT $2 OFFSET $3`, groupID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.GroupStatusLog, 0)
	for rows.Next() {
		var l models.GroupStatusLog
		if err := rows.Scan(&l.ID, &l.GroupID, &l.FromStatus, &l.ToStatus, &l.Reason,
			&l.OperatorID, &l.OperatorName, &l.OperatorType, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, total, nil
}
