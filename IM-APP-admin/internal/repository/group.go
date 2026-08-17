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
		args = append(args, status)
		where += " AND g.status=$" + itoa(len(args))
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
		       COALESCE(g.announcement,'')
		FROM groups g LEFT JOIN users ou ON ou.id=g.owner_id WHERE g.id=$1::uuid`, groupID,
	).Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.OwnerName, &g.MemberCount, &g.Status,
		&g.AllMuted, &g.CreatedAt, &g.JoinMode, &g.AllowMemberAddFriend, &g.Announcement)
	if err != nil {
		return nil, err
	}
	g.Status = normalizeGroupStatus(g.Status)
	return &g, nil
}

func (r *DataRepo) ListGroupMembers(ctx context.Context, groupID string) ([]models.AppGroupMember, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT gm.user_id::text, COALESCE(u.nickname,''), COALESCE(gm.role,'member'),
		       gm.muted_until, gm.joined_at
		FROM group_members gm JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.AppGroupMember, 0)
	for rows.Next() {
		var m models.AppGroupMember
		if err := rows.Scan(&m.UserID, &m.Nickname, &m.Role, &m.MutedUntil, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
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

func (r *DataRepo) SetGroupMuteAll(ctx context.Context, groupID string, muted bool, reason, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE groups SET all_muted=$2 WHERE id=$1::uuid`, groupID, muted); err != nil {
		return err
	}
	to := "normal"
	if muted {
		to = "muted"
	}
	if err := r.logGroupStatusTx(ctx, tx, groupID, to, reason, operatorID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *DataRepo) SetGroupAddFriend(ctx context.Context, groupID string, enabled bool, reason, operatorID string) error {
	_, err := r.DB.Exec(ctx, `UPDATE groups SET allow_member_add_friend=$2 WHERE id=$1::uuid`, groupID, enabled)
	return err
}

// DissolveGroup 解散群：标记 dismissed（与 server 群状态规范一致）+ 状态日志（不扩展 groups 列）
func (r *DataRepo) DissolveGroup(ctx context.Context, groupID, reason, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE groups SET status='dismissed' WHERE id=$1::uuid`, groupID); err != nil {
		return err
	}
	if err := r.logGroupStatusTx(ctx, tx, groupID, "dismissed", reason, operatorID); err != nil {
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

// RecallMessage 管理撤回：写 message_recall_logs + 状态日志（保留占位与审计，不物理删除消息）
func (r *DataRepo) RecallMessage(ctx context.Context, groupID, messageID, reason, operatorID string) error {
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
