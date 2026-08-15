package repository

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 工作台（清单 02） =====

func (r *OpsRepo) DashboardOverview(ctx context.Context) (*models.DashboardOverview, error) {
	o := &models.DashboardOverview{}
	var firstErr error
	check := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&o.Users))
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE updated_at >= NOW() - interval '1 day'`).Scan(&o.ActiveToday))
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM groups`).Scan(&o.Groups))
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM messages WHERE created_at >= NOW() - interval '1 day'`).Scan(&o.MessagesToday))
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM forward_tasks`).Scan(&o.ForwardTasks))
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM sms_send_logs WHERE created_at >= NOW() - interval '1 day'`).Scan(&o.SmsSentToday))
	check(r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM reports WHERE status IN ('pending','processing','reopened')`).Scan(&o.PendingReports))
	if firstErr != nil {
		return o, firstErr
	}
	return o, nil
}

func (r *OpsRepo) DashboardTrends(ctx context.Context, days int) ([]models.DashboardTrend, error) {
	rows, err := r.DB.Query(ctx, `
		WITH dates AS (
			SELECT generate_series(NOW() - ($1 - 1)::int * interval '1 day', NOW(), interval '1 day')::date AS d
		)
		SELECT to_char(d.d, 'YYYY-MM-DD'),
		       (SELECT COUNT(*) FROM users WHERE created_at::date = d.d),
		       (SELECT COUNT(*) FROM users WHERE updated_at::date = d.d),
		       (SELECT COUNT(*) FROM messages WHERE created_at::date = d.d),
		       (SELECT COUNT(*) FROM reports WHERE created_at::date = d.d),
		       (SELECT COUNT(*) FROM forward_tasks WHERE created_at::date = d.d)
		FROM dates d ORDER BY d.d`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.DashboardTrend, 0)
	for rows.Next() {
		var t models.DashboardTrend
		if err := rows.Scan(&t.Date, &t.Registrations, &t.Active, &t.Messages, &t.Reports, &t.Forwards); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (r *OpsRepo) DashboardTodos(ctx context.Context) ([]models.DashboardTodo, error) {
	out := make([]models.DashboardTodo, 0)
	rows, err := r.DB.Query(ctx, `
		SELECT 'report' AS type, id::text, report_no, created_at FROM reports WHERE status IN ('pending','reopened') ORDER BY created_at DESC LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var t models.DashboardTodo
			if rows.Scan(&t.Type, &t.TargetID, &t.Title, &t.CreatedAt) == nil {
				out = append(out, t)
			}
		}
		rows.Close()
	}
	rows2, err := r.DB.Query(ctx, `
		SELECT 'forward_risk' AS type, id::text, risk_type, created_at FROM forward_risk_events ORDER BY created_at DESC LIMIT 10`)
	if err == nil {
		for rows2.Next() {
			var t models.DashboardTodo
			if rows2.Scan(&t.Type, &t.TargetID, &t.Title, &t.CreatedAt) == nil {
				out = append(out, t)
			}
		}
		rows2.Close()
	}
	rows3, err := r.DB.Query(ctx, `
		SELECT 'system_alert' AS type, id::text, message, last_at FROM system_error_events ORDER BY last_at DESC LIMIT 10`)
	if err == nil {
		for rows3.Next() {
			var t models.DashboardTodo
			if rows3.Scan(&t.Type, &t.TargetID, &t.Title, &t.CreatedAt) == nil {
				out = append(out, t)
			}
		}
		rows3.Close()
	}
	return out, nil
}
