package repository

import (
	"context"
	"strings"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditRepo 审计日志（表：admin_audit_logs）
type AuditRepo struct{ DB *pgxpool.Pool }

// InsertAudit 实现 middleware.AuditStore，统一写入审计
func (r *AuditRepo) InsertAudit(ctx context.Context, log *middleware.AuditLog) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO admin_audit_logs(admin_id, action, resource, resource_id, reason,
			before_value, after_value, ip, user_agent, request_id, result)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		nullableUUID(log.AdminID), log.Action, log.Resource, log.ResourceID, log.Reason,
		log.Before, log.After, log.IP, truncateStr(log.UserAgent, 255), log.RequestID, log.Result)
	return err
}

// ListAuditLogs 审计列表（可按关键字/结果/资源筛选）
func (r *AuditRepo) ListAuditLogs(ctx context.Context, keyword, result, resource string, limit, offset int) ([]models.AuditLog, int64, error) {
	where := buildAuditWhere(keyword, result, resource)
	var total int64
	if err := r.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM admin_audit_logs l LEFT JOIN admin_users a ON a.id=l.admin_id WHERE 1=1`+where.where, where.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args := append(append([]any{}, where.args...), limit, offset)
	rows, err := r.DB.Query(ctx, `
		SELECT l.id, l.admin_id::text, COALESCE(a.nickname,''), l.action, l.resource,
		       l.resource_id, l.reason, l.before_value, l.after_value, l.ip, l.user_agent,
		       l.request_id, l.result, l.created_at
		FROM admin_audit_logs l LEFT JOIN admin_users a ON a.id = l.admin_id
		WHERE 1=1`+where.where+`
		ORDER BY l.created_at DESC LIMIT $`+itoa(len(where.args)+1)+` OFFSET $`+itoa(len(where.args)+2),
		args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.AuditLog, 0)
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.AdminName, &l.Action, &l.Resource,
			&l.ResourceID, &l.Reason, &l.Before, &l.After, &l.IP, &l.UserAgent,
			&l.RequestID, &l.Result, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, total, nil
}

func (r *AuditRepo) GetAuditLog(ctx context.Context, id int64) (*models.AuditLog, error) {
	var l models.AuditLog
	err := r.DB.QueryRow(ctx, `
		SELECT l.id, l.admin_id::text, COALESCE(a.nickname,''), l.action, l.resource,
		       l.resource_id, l.reason, l.before_value, l.after_value, l.ip, l.user_agent,
		       l.request_id, l.result, l.created_at
		FROM admin_audit_logs l LEFT JOIN admin_users a ON a.id = l.admin_id
		WHERE l.id=$1`, id,
	).Scan(&l.ID, &l.AdminID, &l.AdminName, &l.Action, &l.Resource, &l.ResourceID,
		&l.Reason, &l.Before, &l.After, &l.IP, &l.UserAgent, &l.RequestID, &l.Result, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

type auditWhere struct {
	where string
	args  []any
}

func buildAuditWhere(keyword, result, resource string) auditWhere {
	w := auditWhere{where: "", args: make([]any, 0)}
	if keyword != "" {
		w.args = append(w.args, "%"+keyword+"%")
		w.where += " AND (COALESCE(a.nickname,'') ILIKE $" + itoa(len(w.args)) +
			" OR l.action ILIKE $" + itoa(len(w.args)) +
			" OR l.resource_id ILIKE $" + itoa(len(w.args)) +
			" OR l.ip ILIKE $" + itoa(len(w.args)) + ")"
	}
	if result != "" {
		w.args = append(w.args, result)
		w.where += " AND l.result=$" + itoa(len(w.args))
	}
	if resource != "" {
		w.args = append(w.args, resource)
		w.where += " AND l.resource=$" + itoa(len(w.args))
	}
	return w
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.TrimSpace(s[:n])
}
