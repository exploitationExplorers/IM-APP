package repository

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 消息发送记录与失败排查（读核心库） =====

// im_message_audit 存 OpenIM id（业务 UUID 去横线小写），JOIN 昵称须用 LOWER(REPLACE(id::text,'-',''))。
const messageAuditFrom = `
	FROM im_message_audit a
	LEFT JOIN users  su ON LOWER(REPLACE(su.id::text,'-','')) = a.sender_im_id
	LEFT JOIN users  ru ON LOWER(REPLACE(ru.id::text,'-','')) = a.receiver_im_id
	LEFT JOIN groups g  ON LOWER(REPLACE(g.id::text,'-',''))  = a.group_im_id`

func buildMessageAuditWhere(f models.MessageAuditFilter) (string, []any) {
	where := ""
	args := make([]any, 0)
	if f.ContentType > 0 {
		args = append(args, f.ContentType)
		where += " AND a.content_type=$" + itoa(len(args))
	}
	switch f.PeerType {
	case "group":
		where += " AND a.group_im_id <> ''"
	case "c2c":
		where += " AND a.group_im_id = ''"
	}
	if f.SenderKeyword != "" {
		args = append(args, "%"+f.SenderKeyword+"%")
		where += " AND (COALESCE(su.nickname,'') ILIKE $" + itoa(len(args)) + " OR a.sender_im_id ILIKE $" + itoa(len(args)) + ")"
	}
	if !f.From.IsZero() {
		args = append(args, f.From)
		where += " AND a.created_at >= $" + itoa(len(args))
	}
	if !f.To.IsZero() {
		args = append(args, f.To)
		where += " AND a.created_at <= $" + itoa(len(args))
	}
	return where, args
}

// ListMessages 成功消息列表（im_message_audit），按 created_at 倒序分页。
func (r *OpsRepo) ListMessages(ctx context.Context, f models.MessageAuditFilter, limit, offset int) ([]models.MessageRecord, int64, error) {
	where, args := buildMessageAuditWhere(f)
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*)"+messageAuditFrom+" WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, `
		SELECT a.created_at, a.send_time, a.client_msg_id,
		       a.sender_im_id, COALESCE(su.nickname,''),
		       a.receiver_im_id, COALESCE(ru.nickname,''),
		       a.group_im_id, COALESCE(g.name,''),
		       a.content_type,
		       CASE WHEN a.group_im_id <> '' THEN 'group' ELSE 'c2c' END AS peer_type`+
		messageAuditFrom+" WHERE 1=1"+where+
		" ORDER BY a.created_at DESC LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.MessageRecord, 0)
	for rows.Next() {
		var m models.MessageRecord
		if err := rows.Scan(&m.CreatedAt, &m.SendTime, &m.ClientMsgID,
			&m.SenderIMID, &m.SenderNickname, &m.ReceiverIMID, &m.ReceiverNickname,
			&m.GroupIMID, &m.GroupName, &m.ContentType, &m.PeerType); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, nil
}

// 失败表 sender_id/target_id 为业务 UUID（可空），直接按 id JOIN；target 按 peer_type 区分用户/群。
const messageFailureFrom = `
	FROM im_message_send_failures f
	LEFT JOIN users  su ON su.id = f.sender_id
	LEFT JOIN users  tu ON tu.id = f.target_id AND f.peer_type = 'c2c'
	LEFT JOIN groups g  ON g.id  = f.target_id AND f.peer_type = 'group'`

func buildMessageFailureWhere(f models.MessageFailureFilter) (string, []any) {
	where := ""
	args := make([]any, 0)
	if f.ContentType > 0 {
		args = append(args, f.ContentType)
		where += " AND f.content_type=$" + itoa(len(args))
	}
	if f.FailCode != "" {
		args = append(args, f.FailCode)
		where += " AND f.fail_code=$" + itoa(len(args))
	}
	if f.Source != "" {
		args = append(args, f.Source)
		where += " AND f.source=$" + itoa(len(args))
	}
	if f.SenderKeyword != "" {
		args = append(args, "%"+f.SenderKeyword+"%")
		where += " AND (COALESCE(su.nickname,'') ILIKE $" + itoa(len(args)) + " OR f.sender_im_id ILIKE $" + itoa(len(args)) + ")"
	}
	if !f.From.IsZero() {
		args = append(args, f.From)
		where += " AND f.created_at >= $" + itoa(len(args))
	}
	if !f.To.IsZero() {
		args = append(args, f.To)
		where += " AND f.created_at <= $" + itoa(len(args))
	}
	return where, args
}

// ListMessageFailures 失败消息列表（im_message_send_failures），按 created_at 倒序分页。
func (r *OpsRepo) ListMessageFailures(ctx context.Context, f models.MessageFailureFilter, limit, offset int) ([]models.MessageFailure, int64, error) {
	where, args := buildMessageFailureWhere(f)
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*)"+messageFailureFrom+" WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, `
		SELECT f.id, f.created_at, f.occurred_at, f.client_msg_id,
		       COALESCE(f.sender_id::text,''), f.sender_im_id, COALESCE(su.nickname,''),
		       f.peer_type, COALESCE(f.target_id::text,''), f.target_im_id,
		       COALESCE(tu.nickname, g.name, ''),
		       f.content_type, f.source, f.stage, f.fail_code, f.fail_message,
		       f.client_platform, f.app_version`+
		messageFailureFrom+" WHERE 1=1"+where+
		" ORDER BY f.created_at DESC LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.MessageFailure, 0)
	for rows.Next() {
		var m models.MessageFailure
		if err := rows.Scan(&m.ID, &m.CreatedAt, &m.OccurredAt, &m.ClientMsgID,
			&m.SenderID, &m.SenderIMID, &m.SenderNickname, &m.PeerType,
			&m.TargetID, &m.TargetIMID, &m.TargetName, &m.ContentType,
			&m.Source, &m.Stage, &m.FailCode, &m.FailMessage,
			&m.Platform, &m.AppVersion); err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, nil
}
