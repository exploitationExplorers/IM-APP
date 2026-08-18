package repository

import (
	"context"
	"encoding/json"
	"time"

	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OpsRepo 转发/短信/配置/敏感词/审计/工作台（清单 06/07/08/09/10/02）
type OpsRepo struct{ DB *pgxpool.Pool }

// ===== 转发/群发与风控（清单 06） =====

const forwardSelect = `
	SELECT ft.id::text, ft.user_id::text, ft.status, ft.target_count, ft.created_at,
	       COALESCE(ft.finished_at, ft.updated_at),
	       ft.success_count, ft.failed_count, ft.skipped_count,
	       (ft.idempotency_key <> '' AND EXISTS (
	           SELECT 1 FROM forward_tasks f2
	           WHERE f2.idempotency_key = ft.idempotency_key
	             AND f2.id <> ft.id AND f2.created_at <= ft.created_at
	       )) AS is_duplicate
	FROM forward_tasks ft`

func scanForwardTask(row pgx.Row) (models.ForwardTask, error) {
	var t models.ForwardTask
	var finishedAt time.Time
	err := row.Scan(&t.ID, &t.UserID, &t.Status, &t.TargetCount, &t.CreatedAt, &finishedAt,
		&t.SuccessCount, &t.FailedCount, &t.SkippedCount, &t.IsDuplicate)
	if !finishedAt.IsZero() {
		t.FinishedAt = &finishedAt
	}
	return t, err
}

func (r *OpsRepo) ListForwardTasks(ctx context.Context, status string, limit, offset int) ([]models.ForwardTask, int64, error) {
	where := ""
	args := make([]any, 0)
	if status != "" && status != "all" {
		args = append(args, status)
		where += " WHERE ft.status=$" + itoa(len(args))
	}
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM forward_tasks ft"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, forwardSelect+where+
		" ORDER BY ft.created_at DESC LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ForwardTask, 0)
	for rows.Next() {
		t, err := scanForwardTask(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, nil
}

func (r *OpsRepo) GetForwardTask(ctx context.Context, taskID string) (*models.ForwardTask, error) {
	t, err := scanForwardTask(r.DB.QueryRow(ctx, forwardSelect+" WHERE ft.id=$1::uuid", taskID))
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *OpsRepo) ListForwardTargets(ctx context.Context, taskID, status string, limit, offset int) ([]models.ForwardTarget, int64, error) {
	where := " WHERE t.task_id=$1::uuid"
	args := []any{taskID}
	if status != "" && status != "all" {
		args = append(args, status)
		where += " AND t.status=$" + itoa(len(args))
	}
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM forward_task_targets t"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, `
		SELECT t.id::text, t.user_id::text, COALESCE(u.nickname,''), t.status, t.attempts,
		       COALESCE(t.message_id::text,''), COALESCE(t.fail_code,''), t.finished_at
		FROM forward_task_targets t LEFT JOIN users u ON u.id=t.user_id`+where+
		" ORDER BY t.created_at LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ForwardTarget, 0)
	for rows.Next() {
		var t models.ForwardTarget
		if err := rows.Scan(&t.ID, &t.UserID, &t.Nickname, &t.Status, &t.Attempts,
			&t.MessageID, &t.FailCode, &t.FinishedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, nil
}

// ForwardFailures 失败原因统计
func (r *OpsRepo) ForwardFailures(ctx context.Context, taskID string) ([]map[string]any, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT fail_code, COUNT(*) AS cnt FROM forward_task_targets
		WHERE task_id=$1::uuid AND status='failed' GROUP BY fail_code ORDER BY cnt DESC`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var code string
		var cnt int64
		if err := rows.Scan(&code, &cnt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"failCode": code, "count": cnt})
	}
	return out, nil
}

func (r *OpsRepo) CancelForwardTask(ctx context.Context, taskID, operatorID, reason string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		UPDATE forward_tasks SET status='cancelled', updated_at=NOW()
		WHERE id=$1::uuid AND status IN ('pending','processing')`, taskID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return tx.Commit(ctx) // 终态任务无需取消，也不写取消审计
	}
	if _, err := tx.Exec(ctx, `
		UPDATE forward_task_targets SET status='cancelled', finished_at=NOW()
		WHERE task_id=$1::uuid AND status='pending'`, taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO forward_task_actions(task_id, admin_id, action, detail)
		VALUES($1::uuid,$2::uuid,'cancel',$3)`, taskID, operatorID, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *OpsRepo) RetryFailedTargets(ctx context.Context, taskID, operatorID string) (int64, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	// 终态任务（cancelled/success）不可重试，先校验任务状态
	var taskStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM forward_tasks WHERE id=$1::uuid`, taskID).Scan(&taskStatus); err != nil {
		return 0, err
	}
	if taskStatus != "pending" && taskStatus != "processing" && taskStatus != "failed" {
		return 0, tx.Commit(ctx) // 终态任务不重试
	}
	tag, err := tx.Exec(ctx, `
		UPDATE forward_task_targets SET status='pending', fail_code='', finished_at=NULL
		WHERE task_id=$1::uuid AND status='failed' AND attempts < 3`, taskID)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		// 无 failed 目标可重试：不改任务状态、不写审计
		return 0, tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE forward_tasks SET status='processing', updated_at=NOW() WHERE id=$1::uuid`, taskID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO forward_task_actions(task_id, admin_id, action, detail)
		VALUES($1::uuid,$2::uuid,'retry', $3)`, taskID, operatorID, "retry failed targets"); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), tx.Commit(ctx)
}

func (r *OpsRepo) GetForwardUserLimit(ctx context.Context, userID string) (*models.ForwardUserLimit, error) {
	var l models.ForwardUserLimit
	err := r.DB.QueryRow(ctx, `
		SELECT user_id::text, daily_limit, hourly_limit, single_targets, enabled
		FROM forward_user_limits WHERE user_id=$1::uuid`, userID).Scan(&l.UserID, &l.DailyLimit, &l.HourlyLimit, &l.SingleTargets, &l.Enabled)
	if err == pgx.ErrNoRows {
		def, _ := r.GetForwardSettings(ctx)
		return &models.ForwardUserLimit{
			UserID:        userID,
			DailyLimit:    def.DefaultDailyLimit,
			HourlyLimit:   def.DefaultHourlyLimit,
			SingleTargets: def.DefaultSingleTargets,
			Enabled:       true,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *OpsRepo) SetForwardUserLimit(ctx context.Context, userID string, req models.ForwardLimitRequest, operatorID string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO forward_user_limits(user_id, daily_limit, hourly_limit, single_targets, enabled, updated_by)
		VALUES($1::uuid,
		       COALESCE($2, (SELECT daily_limit FROM forward_user_limits WHERE user_id=$1::uuid), 100),
		       COALESCE($3, (SELECT hourly_limit FROM forward_user_limits WHERE user_id=$1::uuid), 20),
		       COALESCE($4, (SELECT single_targets FROM forward_user_limits WHERE user_id=$1::uuid), 10000),
		       COALESCE($5, true), $6::uuid)
		ON CONFLICT (user_id) DO UPDATE SET
			daily_limit=COALESCE($2, forward_user_limits.daily_limit),
			hourly_limit=COALESCE($3, forward_user_limits.hourly_limit),
			single_targets=COALESCE($4, forward_user_limits.single_targets),
			enabled=COALESCE($5, forward_user_limits.enabled),
			updated_by=$6::uuid, updated_at=NOW()`,
		userID, req.DailyLimit, req.HourlyLimit, req.SingleTargets, req.Enabled, operatorID)
	if err != nil {
		return err
	}
	_, err = r.DB.Exec(ctx, `
		INSERT INTO forward_task_actions(task_id, admin_id, action, detail)
		VALUES('00000000-0000-0000-0000-000000000000', $1::uuid, 'limit_change', $2)`,
		operatorID, "user="+userID)
	return err
}

// ===== 全局转发规则（存 app_configs） =====

const cfgKeyForwardSettings = "forward.settings"

func (r *OpsRepo) GetForwardSettings(ctx context.Context) (*models.ForwardSettings, error) {
	s := &models.ForwardSettings{DefaultDailyLimit: 100, DefaultHourlyLimit: 20, DefaultSingleTargets: 10000, MaxSingleTargets: 100000}
	var raw string
	if err := r.DB.QueryRow(ctx, `SELECT value FROM app_configs WHERE key=$1`, cfgKeyForwardSettings).Scan(&raw); err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), s)
	}
	return s, nil
}

func (r *OpsRepo) SetForwardSettings(ctx context.Context, s *models.ForwardSettings, operatorID string) error {
	b, _ := json.Marshal(s)
	_, err := r.DB.Exec(ctx, `
		INSERT INTO app_configs(key, value, description, updated_by, updated_at)
		VALUES($1,$2,'全局转发规则',$3::uuid,NOW())
		ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3::uuid, updated_at=NOW()`,
		cfgKeyForwardSettings, string(b), operatorID)
	return err
}
