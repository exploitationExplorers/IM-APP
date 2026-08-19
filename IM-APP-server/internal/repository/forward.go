package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrForwardTaskNotFound     = errors.New("forward task not found")
	ErrForwardTaskState        = errors.New("invalid forward task state")
	ErrForwardIdempotencyReuse = errors.New("forward idempotency key reused")
)

type ForwardRepo struct {
	DB *pgxpool.Pool
}

type CreateForwardTaskParams struct {
	UserID               string
	SourceMessageID      string
	SourceConversationID string
	SourceClientMsgID    string
	SourceServerMsgID    string
	Snapshot             models.ForwardMessageSnapshot
	Selector             models.ForwardSelector
	IdempotencyKey       string
}

const forwardTaskSelect = `
	SELECT ft.id::text, ft.user_id::text, COALESCE(ft.source_message_id,''),
		ft.source_conversation_id, ft.source_client_msg_id, ft.source_server_msg_id,
		ft.source_snapshot, ft.selector, COALESCE(ft.idempotency_key,''), ft.status,
		ft.target_count, ft.done_count, ft.success_count, ft.failed_count, ft.skipped_count, ft.cancelled_count,
		(SELECT COUNT(*) FROM forward_task_targets t WHERE t.task_id=ft.id AND t.status IN ('pending','retrying')),
		(SELECT COUNT(*) FROM forward_task_targets t WHERE t.task_id=ft.id AND t.status='processing'),
		ft.started_at, ft.finished_at, ft.created_at, ft.updated_at
	FROM forward_tasks ft`

func scanForwardTask(row pgx.Row) (models.ForwardTask, error) {
	var task models.ForwardTask
	var snapshotRaw, selectorRaw []byte
	err := row.Scan(&task.ID, &task.UserID, &task.SourceMessageID,
		&task.SourceConversationID, &task.SourceClientMsgID, &task.SourceServerMsgID,
		&snapshotRaw, &selectorRaw, &task.IdempotencyKey, &task.Status,
		&task.TargetCount, &task.DoneCount, &task.SuccessCount, &task.FailedCount, &task.SkippedCount, &task.CancelledCount,
		&task.PendingCount, &task.ProcessingCount, &task.StartedAt, &task.FinishedAt,
		&task.CreatedAt, &task.UpdatedAt)
	if err != nil {
		return task, err
	}
	if len(snapshotRaw) > 0 {
		_ = json.Unmarshal(snapshotRaw, &task.SourceSnapshot)
	}
	if len(selectorRaw) > 0 {
		_ = json.Unmarshal(selectorRaw, &task.Selector)
	}
	return task, nil
}

func (r *ForwardRepo) CreateTask(ctx context.Context, p CreateForwardTaskParams) (models.ForwardTask, error) {
	snapshot, err := json.Marshal(p.Snapshot)
	if err != nil {
		return models.ForwardTask{}, err
	}
	selector, err := json.Marshal(p.Selector)
	if err != nil {
		return models.ForwardTask{}, err
	}
	var id string
	err = r.DB.QueryRow(ctx, `
		INSERT INTO forward_tasks(
			user_id, source_message_id, source_conversation_id, source_client_msg_id,
			source_server_msg_id, source_content_type, source_snapshot, selector,
			idempotency_key, target_count, done_count, status)
		VALUES($1::uuid,NULLIF($2,''),$3,$4,$5,$6,$7::jsonb,$8::jsonb,NULLIF($9,''),0,0,'draft')
		ON CONFLICT (user_id,idempotency_key)
			WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''
		DO NOTHING
		RETURNING id::text`, p.UserID, p.SourceMessageID, p.SourceConversationID,
		p.SourceClientMsgID, p.SourceServerMsgID, p.Snapshot.ContentType,
		snapshot, selector, p.IdempotencyKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, getErr := r.GetTaskByIdempotency(ctx, p.UserID, p.IdempotencyKey)
		if getErr != nil {
			return models.ForwardTask{}, getErr
		}
		if existing.SourceConversationID != p.SourceConversationID ||
			existing.SourceClientMsgID != p.SourceClientMsgID {
			return models.ForwardTask{}, ErrForwardIdempotencyReuse
		}
		return existing, nil
	}
	if err != nil {
		return models.ForwardTask{}, err
	}
	return r.GetTask(ctx, p.UserID, id)
}

func (r *ForwardRepo) GetTaskByIdempotency(ctx context.Context, userID, key string) (models.ForwardTask, error) {
	task, err := scanForwardTask(r.DB.QueryRow(ctx, forwardTaskSelect+`
		WHERE ft.user_id=$1::uuid AND ft.idempotency_key=$2`, userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return task, ErrForwardTaskNotFound
	}
	return task, err
}

func (r *ForwardRepo) GetTask(ctx context.Context, userID, taskID string) (models.ForwardTask, error) {
	task, err := scanForwardTask(r.DB.QueryRow(ctx, forwardTaskSelect+`
		WHERE ft.id=$2::uuid AND ft.user_id=$1::uuid`, userID, taskID))
	if errors.Is(err, pgx.ErrNoRows) {
		return task, ErrForwardTaskNotFound
	}
	return task, err
}

func (r *ForwardRepo) GetTaskForWorker(ctx context.Context, taskID string) (models.ForwardTask, error) {
	task, err := scanForwardTask(r.DB.QueryRow(ctx, forwardTaskSelect+` WHERE ft.id=$1::uuid`, taskID))
	if errors.Is(err, pgx.ErrNoRows) {
		return task, ErrForwardTaskNotFound
	}
	return task, err
}

// GetForwardLimit 查用户转发限额（无记录返回默认值：日 100 / 时 20 / 单次 10000 / 启用）
func (r *ForwardRepo) GetForwardLimit(ctx context.Context, userID string) (daily, hourly, single int, enabled bool, err error) {
	daily, hourly, single, enabled = 100, 20, 10000, true
	err = r.DB.QueryRow(ctx, `
		SELECT daily_limit, hourly_limit, single_targets, enabled
		FROM forward_user_limits WHERE user_id=$1::uuid`, userID).Scan(&daily, &hourly, &single, &enabled)
	if err == pgx.ErrNoRows {
		return daily, hourly, single, enabled, nil
	}
	return daily, hourly, single, enabled, err
}

// CountForwardTargetsSince 统计用户某时间点后创建的转发任务目标总数（不含已取消）
func (r *ForwardRepo) CountForwardTargetsSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	var n int64
	err := r.DB.QueryRow(ctx, `
		SELECT COALESCE(SUM(target_count),0) FROM forward_tasks
		WHERE user_id=$1::uuid AND created_at >= $2 AND status <> 'cancelled'`, userID, since).Scan(&n)
	return n, err
}

func (r *ForwardRepo) ListTasks(ctx context.Context, userID, status, cursor string, limit int) (models.ForwardTaskPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.DB.Query(ctx, forwardTaskSelect+`
		WHERE ft.user_id=$1::uuid AND ($2='' OR ft.status=$2)
		  AND (NULLIF($3,'') IS NULL OR (ft.created_at,ft.id) < (
			SELECT created_at,id FROM forward_tasks WHERE id=NULLIF($3,'')::uuid AND user_id=$1::uuid))
		ORDER BY ft.created_at DESC, ft.id DESC LIMIT $4`, userID, status, cursor, limit+1)
	if err != nil {
		return models.ForwardTaskPage{}, err
	}
	defer rows.Close()
	items := make([]models.ForwardTask, 0, limit+1)
	for rows.Next() {
		item, err := scanForwardTask(rows)
		if err != nil {
			return models.ForwardTaskPage{}, err
		}
		items = append(items, item)
	}
	page := models.ForwardTaskPage{Items: items}
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
		page.NextCursor = page.Items[len(page.Items)-1].ID
	}
	return page, rows.Err()
}

func (r *ForwardRepo) AddTargets(ctx context.Context, userID, taskID string, userIDs []string) (int64, error) {
	if len(userIDs) == 0 {
		return 0, nil
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM forward_tasks
		WHERE id=$2::uuid AND user_id=$1::uuid FOR UPDATE`, userID, taskID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrForwardTaskNotFound
		}
		return 0, err
	}
	if status != models.ForwardTaskDraft {
		return 0, ErrForwardTaskState
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO forward_task_targets(task_id,user_id)
		SELECT $2::uuid, candidate.id
		FROM users candidate
		JOIN friendships f ON f.user_id=$1::uuid AND f.friend_id=candidate.id
		WHERE candidate.id=ANY($3::uuid[]) AND candidate.id<>$1::uuid
		  AND COALESCE(candidate.status,'active')='active'
		ON CONFLICT(task_id,user_id) DO NOTHING`, userID, taskID, userIDs)
	if err != nil {
		return 0, err
	}
	if err := refreshTargetCountTx(ctx, tx, taskID); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *ForwardRepo) GenerateTargets(ctx context.Context, userID, taskID string, selector models.ForwardSelector) (int64, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM forward_tasks
		WHERE id=$2::uuid AND user_id=$1::uuid FOR UPDATE`, userID, taskID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrForwardTaskNotFound
		}
		return 0, err
	}
	if status != models.ForwardTaskDraft {
		return 0, ErrForwardTaskState
	}
	tagIDs := selector.TagIDs
	if tagIDs == nil {
		tagIDs = []string{}
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO forward_task_targets(task_id,user_id)
		SELECT $2::uuid, u.id
		FROM friendships f
		JOIN users u ON u.id=f.friend_id AND COALESCE(u.status,'active')='active'
		WHERE f.user_id=$1::uuid
		  AND ($3='' OR u.nickname ILIKE '%%'||$3||'%%'
		       OR COALESCE(f.remark,'') ILIKE '%%'||$3||'%%'
		       OR COALESCE(u.public_id,'') ILIKE '%%'||$3||'%%')
		  AND (cardinality($4::uuid[])=0 OR EXISTS(
			SELECT 1 FROM contact_tag_members ctm
			JOIN contact_tags ct ON ct.id=ctm.tag_id AND ct.user_id=$1::uuid
			WHERE ctm.friend_id=u.id AND ct.id=ANY($4::uuid[])))
		ON CONFLICT(task_id,user_id) DO NOTHING`, userID, taskID, selector.Keyword, tagIDs)
	if err != nil {
		return 0, err
	}
	selectorRaw, _ := json.Marshal(selector)
	if _, err := tx.Exec(ctx, `UPDATE forward_tasks SET selector=$2::jsonb,updated_at=NOW()
		WHERE id=$1::uuid`, taskID, selectorRaw); err != nil {
		return 0, err
	}
	if err := refreshTargetCountTx(ctx, tx, taskID); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *ForwardRepo) RemoveTargets(ctx context.Context, userID, taskID string, userIDs []string) (int64, error) {
	task, err := r.GetTask(ctx, userID, taskID)
	if err != nil {
		return 0, err
	}
	if task.Status != models.ForwardTaskDraft {
		return 0, ErrForwardTaskState
	}
	tag, err := r.DB.Exec(ctx, `DELETE FROM forward_task_targets t USING forward_tasks ft
		WHERE t.task_id=ft.id AND ft.id=$2::uuid AND ft.user_id=$1::uuid
		  AND ft.status='draft' AND t.user_id=ANY($3::uuid[])`, userID, taskID, userIDs)
	if err != nil {
		return 0, err
	}
	_, err = r.DB.Exec(ctx, `UPDATE forward_tasks SET target_count=(
		SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$2::uuid),updated_at=NOW()
		WHERE id=$2::uuid AND user_id=$1::uuid AND status='draft'`, userID, taskID)
	return tag.RowsAffected(), err
}

func (r *ForwardRepo) ClearTargets(ctx context.Context, userID, taskID string) (int64, error) {
	task, err := r.GetTask(ctx, userID, taskID)
	if err != nil {
		return 0, err
	}
	if task.Status != models.ForwardTaskDraft {
		return 0, ErrForwardTaskState
	}
	tag, err := r.DB.Exec(ctx, `DELETE FROM forward_task_targets t USING forward_tasks ft
		WHERE t.task_id=ft.id AND ft.id=$2::uuid AND ft.user_id=$1::uuid AND ft.status='draft'`, userID, taskID)
	if err != nil {
		return 0, err
	}
	_, err = r.DB.Exec(ctx, `UPDATE forward_tasks SET target_count=0,updated_at=NOW()
		WHERE id=$2::uuid AND user_id=$1::uuid AND status='draft'`, userID, taskID)
	return tag.RowsAffected(), err
}

func refreshTargetCountTx(ctx context.Context, tx pgx.Tx, taskID string) error {
	_, err := tx.Exec(ctx, `UPDATE forward_tasks SET target_count=(
		SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid),updated_at=NOW()
		WHERE id=$1::uuid`, taskID)
	return err
}

func (r *ForwardRepo) SubmitTask(ctx context.Context, userID, taskID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE forward_tasks SET status='pending',started_at=NULL,
		finished_at=NULL,last_error='',updated_at=NOW()
		WHERE id=$2::uuid AND user_id=$1::uuid AND status='draft'
		  AND target_count>0 AND source_content_type>0
		  AND source_snapshot <> '{}'::jsonb`, userID, taskID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM forward_tasks
			WHERE id=$2::uuid AND user_id=$1::uuid)`, userID, taskID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrForwardTaskNotFound
		}
		return ErrForwardTaskState
	}
	if err := recordActionTx(ctx, tx, taskID, userID, "submit", map[string]any{}); err != nil {
		return err
	}
	if err := enqueueKafkaOutboxTx(ctx, tx, taskID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ForwardRepo) CancelTask(ctx context.Context, userID, taskID, reason string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE forward_tasks SET status='cancelled',cancelled_at=NOW(),
		updated_at=NOW(),last_error=$3 WHERE id=$2::uuid AND user_id=$1::uuid
		AND status NOT IN ('completed','partially_completed','failed','cancelled')`, userID, taskID, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return r.classifyTaskUpdateFailure(ctx, userID, taskID)
	}
	if _, err := tx.Exec(ctx, `UPDATE forward_task_targets SET status='cancelled',
		finished_at=NOW(),updated_at=NOW(),locked_by='',locked_until=NULL
		WHERE task_id=$1::uuid AND status IN ('pending','retrying')`, taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE forward_tasks SET cancelled_count=(
		SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid AND status='cancelled'),
		done_count=(SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid
			AND status IN ('success','failed','skipped','cancelled')),
		finished_at=CASE WHEN (SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid
			AND status IN ('success','failed','skipped','cancelled'))>=target_count THEN NOW() ELSE NULL END
		WHERE id=$1::uuid`, taskID); err != nil {
		return err
	}
	if err := recordActionTx(ctx, tx, taskID, userID, "cancel", map[string]any{"reason": reason}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ForwardRepo) PauseTask(ctx context.Context, userID, taskID string) error {
	tag, err := r.DB.Exec(ctx, `UPDATE forward_tasks SET status='paused',updated_at=NOW()
		WHERE id=$2::uuid AND user_id=$1::uuid AND status IN ('pending','processing')`, userID, taskID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return r.classifyTaskUpdateFailure(ctx, userID, taskID)
	}
	return r.RecordAction(ctx, taskID, userID, "pause", map[string]any{})
}

func (r *ForwardRepo) ResumeTask(ctx context.Context, userID, taskID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE forward_tasks SET status='pending',updated_at=NOW()
		WHERE id=$2::uuid AND user_id=$1::uuid AND status='paused'`, userID, taskID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM forward_tasks
			WHERE id=$2::uuid AND user_id=$1::uuid)`, userID, taskID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrForwardTaskNotFound
		}
		return ErrForwardTaskState
	}
	if err := recordActionTx(ctx, tx, taskID, userID, "resume", map[string]any{}); err != nil {
		return err
	}
	if err := enqueueKafkaOutboxTx(ctx, tx, taskID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ForwardRepo) RetryTask(ctx context.Context, userID, taskID string, onlyFailed bool, userIDs []string) (int64, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var taskStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM forward_tasks
		WHERE id=$2::uuid AND user_id=$1::uuid FOR UPDATE`, userID, taskID).Scan(&taskStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrForwardTaskNotFound
		}
		return 0, err
	}
	if taskStatus != models.ForwardTaskFailed && taskStatus != models.ForwardTaskPartiallyCompleted && taskStatus != models.ForwardTaskCompleted {
		return 0, ErrForwardTaskState
	}
	statuses := []string{models.ForwardTargetFailed}
	if !onlyFailed {
		statuses = append(statuses, models.ForwardTargetSkipped)
	}
	tag, err := tx.Exec(ctx, `UPDATE forward_task_targets t SET status='retrying',
		next_retry_at=NOW(),fail_code='',failure_message='',finished_at=NULL,updated_at=NOW()
		FROM forward_tasks ft WHERE t.task_id=ft.id AND ft.id=$2::uuid AND ft.user_id=$1::uuid
		  AND t.status=ANY($3::text[]) AND (cardinality($4::uuid[])=0 OR t.user_id=ANY($4::uuid[]))`,
		userID, taskID, statuses, userIDs)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() > 0 {
		_, err = tx.Exec(ctx, `UPDATE forward_tasks SET status='pending',finished_at=NULL,
			failed_count=(SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid AND status='failed'),
			skipped_count=(SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid AND status='skipped'),
			done_count=(SELECT COUNT(*) FROM forward_task_targets WHERE task_id=$1::uuid
				AND status IN ('success','failed','skipped','cancelled')),updated_at=NOW()
			WHERE id=$1::uuid`, taskID)
		if err != nil {
			return 0, err
		}
		if err := recordActionTx(ctx, tx, taskID, userID, "retry", map[string]any{"affectedCount": tag.RowsAffected()}); err != nil {
			return 0, err
		}
		if err := enqueueKafkaOutboxTx(ctx, tx, taskID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func enqueueKafkaOutboxTx(ctx context.Context, tx pgx.Tx, taskID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO forward_kafka_outbox(task_id,status,next_attempt_at,updated_at)
		VALUES($1::uuid,'pending',NOW(),NOW())
		ON CONFLICT(task_id) DO UPDATE SET status='pending',next_attempt_at=NOW(),
			locked_by='',locked_until=NULL,last_error='',updated_at=NOW()`, taskID)
	return err
}

func (r *ForwardRepo) classifyTaskUpdateFailure(ctx context.Context, userID, taskID string) error {
	if _, err := r.GetTask(ctx, userID, taskID); err != nil {
		return err
	}
	return ErrForwardTaskState
}

func (r *ForwardRepo) ListTargets(ctx context.Context, userID, taskID, status, cursor string, limit int) (models.ForwardTargetPage, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.DB.Query(ctx, `
		SELECT t.id::text,t.task_id::text,t.user_id::text,t.status,t.attempts,
			t.conversation_id,t.sent_client_msg_id,t.sent_server_msg_id,
			t.fail_code,t.failure_message,t.next_retry_at,t.finished_at,t.created_at,t.updated_at
		FROM forward_task_targets t JOIN forward_tasks ft ON ft.id=t.task_id
		WHERE ft.user_id=$1::uuid AND t.task_id=$2::uuid AND ($3='' OR t.status=$3)
		  AND (NULLIF($4,'') IS NULL OR t.id>NULLIF($4,'')::uuid)
		ORDER BY t.id LIMIT $5`, userID, taskID, status, cursor, limit+1)
	if err != nil {
		return models.ForwardTargetPage{}, err
	}
	defer rows.Close()
	items := make([]models.ForwardTarget, 0, limit+1)
	for rows.Next() {
		var item models.ForwardTarget
		if err := rows.Scan(&item.ID, &item.TaskID, &item.TargetUserID, &item.Status, &item.Attempts,
			&item.ConversationID, &item.SentClientMsgID, &item.SentServerMsgID,
			&item.FailureCode, &item.FailureMessage, &item.NextRetryAt, &item.FinishedAt,
			&item.CreatedAt, &item.UpdatedAt); err != nil {
			return models.ForwardTargetPage{}, err
		}
		items = append(items, item)
	}
	page := models.ForwardTargetPage{Items: items}
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
		page.NextCursor = page.Items[len(page.Items)-1].ID
	}
	return page, rows.Err()
}

func (r *ForwardRepo) ClaimTaskTargets(ctx context.Context, taskID, workerID string, limit int, lockTTL time.Duration) ([]models.ForwardTarget, error) {
	if limit <= 0 {
		limit = 50
	}
	if lockTTL <= 0 {
		lockTTL = time.Minute
	}
	rows, err := r.DB.Query(ctx, `
		WITH picked AS (
			SELECT t.id FROM forward_task_targets t
			JOIN forward_tasks ft ON ft.id=t.task_id
			WHERE ft.status IN ('pending','processing') AND t.task_id=$4::uuid AND (
				(t.status IN ('pending','retrying') AND t.next_retry_at<=NOW()) OR
				(t.status='processing' AND t.locked_until<NOW()))
			ORDER BY t.priority DESC,t.created_at,t.id FOR UPDATE SKIP LOCKED LIMIT $1
		)
		UPDATE forward_task_targets t SET status='processing',attempts=attempts+1,
			locked_by=$2,locked_until=NOW()+($3 * INTERVAL '1 second'),
			started_at=COALESCE(started_at,NOW()),updated_at=NOW()
		FROM picked WHERE t.id=picked.id
		RETURNING t.id::text,t.task_id::text,t.user_id::text,t.status,t.attempts,
			t.conversation_id,t.sent_client_msg_id,t.sent_server_msg_id,
			t.fail_code,t.failure_message,t.next_retry_at,t.finished_at,t.created_at,t.updated_at`,
		limit, workerID, int(lockTTL.Seconds()), taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]models.ForwardTarget, 0, limit)
	for rows.Next() {
		var item models.ForwardTarget
		if err := rows.Scan(&item.ID, &item.TaskID, &item.TargetUserID, &item.Status, &item.Attempts,
			&item.ConversationID, &item.SentClientMsgID, &item.SentServerMsgID,
			&item.FailureCode, &item.FailureMessage, &item.NextRetryAt, &item.FinishedAt,
			&item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.LockedBy = workerID
		items = append(items, item)
	}
	if len(items) > 0 {
		_, _ = r.DB.Exec(ctx, `UPDATE forward_tasks SET status='processing',started_at=COALESCE(started_at,NOW()),updated_at=NOW()
			WHERE id=ANY($1::uuid[]) AND status='pending'`, uniqueTaskIDs(items))
	}
	return items, rows.Err()
}

type ForwardOutboxEvent struct {
	ID       string
	TaskID   string
	Attempts int
	LockedBy string
}

func (r *ForwardRepo) ClaimKafkaOutbox(ctx context.Context, workerID string, limit int, lockTTL time.Duration) ([]ForwardOutboxEvent, error) {
	if limit <= 0 {
		limit = 20
	}
	if lockTTL <= 0 {
		lockTTL = time.Minute
	}
	rows, err := r.DB.Query(ctx, `
		WITH picked AS (
			SELECT id FROM forward_kafka_outbox
			WHERE (status='pending' AND next_attempt_at<=NOW())
			   OR (status='processing' AND locked_until<NOW())
			ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT $1
		)
		UPDATE forward_kafka_outbox o SET status='processing',attempts=attempts+1,
			locked_by=$2,locked_until=NOW()+($3 * INTERVAL '1 second'),updated_at=NOW()
		FROM picked WHERE o.id=picked.id
		RETURNING o.id::text,o.task_id::text,o.attempts,o.locked_by`,
		limit, workerID, int(lockTTL.Seconds()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]ForwardOutboxEvent, 0, limit)
	for rows.Next() {
		var event ForwardOutboxEvent
		if err := rows.Scan(&event.ID, &event.TaskID, &event.Attempts, &event.LockedBy); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (r *ForwardRepo) MarkKafkaOutboxPublished(ctx context.Context, event ForwardOutboxEvent) error {
	tag, err := r.DB.Exec(ctx, `UPDATE forward_kafka_outbox SET status='published',published_at=NOW(),
		locked_by='',locked_until=NULL,last_error='',updated_at=NOW()
		WHERE id=$1::uuid AND status='processing' AND locked_by=$2`, event.ID, event.LockedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrForwardTaskState
	}
	return nil
}

func (r *ForwardRepo) MarkKafkaOutboxRetry(ctx context.Context, event ForwardOutboxEvent, message string, next time.Time) error {
	tag, err := r.DB.Exec(ctx, `UPDATE forward_kafka_outbox SET status='pending',next_attempt_at=$3,
		locked_by='',locked_until=NULL,last_error=$4,updated_at=NOW()
		WHERE id=$1::uuid AND status='processing' AND locked_by=$2`, event.ID, event.LockedBy, next, message)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrForwardTaskState
	}
	return nil
}

func uniqueTaskIDs(items []models.ForwardTarget) []string {
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		if _, ok := seen[item.TaskID]; !ok {
			seen[item.TaskID] = struct{}{}
			out = append(out, item.TaskID)
		}
	}
	return out
}

func (r *ForwardRepo) TargetEligible(ctx context.Context, senderID, targetID string) (bool, string, error) {
	var senderStatus, targetStatus string
	var friend, blocked bool
	err := r.DB.QueryRow(ctx, `SELECT COALESCE(s.status,'active'),COALESCE(t.status,'active'),
		EXISTS(SELECT 1 FROM friendships WHERE user_id=$1::uuid AND friend_id=$2::uuid),
		EXISTS(SELECT 1 FROM user_blocks WHERE (user_id=$1::uuid AND blocked_id=$2::uuid)
			OR (user_id=$2::uuid AND blocked_id=$1::uuid))
		FROM users s JOIN users t ON t.id=$2::uuid WHERE s.id=$1::uuid`, senderID, targetID).
		Scan(&senderStatus, &targetStatus, &friend, &blocked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, "account_not_found", nil
	}
	if err != nil {
		return false, "", err
	}
	switch {
	case senderStatus != "active":
		return false, "sender_inactive", nil
	case targetStatus != "active":
		return false, "target_inactive", nil
	case blocked:
		return false, "blocked", nil
	case !friend:
		return false, "not_friend", nil
	}
	return true, "", nil
}

func (r *ForwardRepo) MarkTargetSuccess(ctx context.Context, target models.ForwardTarget, conversationID, clientMsgID, serverMsgID string) error {
	return r.finishTarget(ctx, target, models.ForwardTargetSuccess, "", "", conversationID, clientMsgID, serverMsgID)
}
func (r *ForwardRepo) MarkTargetSkipped(ctx context.Context, target models.ForwardTarget, code, message string) error {
	return r.finishTarget(ctx, target, models.ForwardTargetSkipped, code, message, "", "", "")
}
func (r *ForwardRepo) MarkTargetFailed(ctx context.Context, target models.ForwardTarget, code, message string) error {
	return r.finishTarget(ctx, target, models.ForwardTargetFailed, code, message, "", "", "")
}
func (r *ForwardRepo) MarkTargetCancelled(ctx context.Context, target models.ForwardTarget, code, message string) error {
	return r.finishTarget(ctx, target, models.ForwardTargetCancelled, code, message, "", "", "")
}
func (r *ForwardRepo) finishTarget(ctx context.Context, target models.ForwardTarget, status, code, message, conversationID, clientMsgID, serverMsgID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE forward_task_targets SET status=$3,fail_code=$4,failure_message=$5,
		conversation_id=COALESCE(NULLIF($6,''),conversation_id),sent_client_msg_id=COALESCE(NULLIF($7,''),sent_client_msg_id),
		sent_server_msg_id=COALESCE(NULLIF($8,''),sent_server_msg_id),finished_at=NOW(),locked_by='',locked_until=NULL,updated_at=NOW()
		WHERE id=$1::uuid AND status='processing' AND locked_by=$2`, target.ID, target.LockedBy, status, code, message, conversationID, clientMsgID, serverMsgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrForwardTaskState
	}
	column := map[string]string{models.ForwardTargetSuccess: "success_count", models.ForwardTargetFailed: "failed_count", models.ForwardTargetSkipped: "skipped_count", models.ForwardTargetCancelled: "cancelled_count"}[status]
	if _, err = tx.Exec(ctx, `UPDATE forward_tasks SET done_count=done_count+1,`+column+`=`+column+`+1,updated_at=NOW() WHERE id=$1::uuid`, target.TaskID); err != nil {
		return err
	}
	if err = finalizeTaskTx(ctx, tx, target.TaskID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ForwardRepo) MarkTargetRetry(ctx context.Context, target models.ForwardTarget, code, message string, next time.Time) error {
	tag, err := r.DB.Exec(ctx, `UPDATE forward_task_targets SET status='retrying',fail_code=$3,failure_message=$4,
		next_retry_at=$5,locked_by='',locked_until=NULL,updated_at=NOW()
		WHERE id=$1::uuid AND status='processing' AND locked_by=$2`, target.ID, target.LockedBy, code, message, next)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrForwardTaskState
	}
	return nil
}

func finalizeTaskTx(ctx context.Context, tx pgx.Tx, taskID string) error {
	_, err := tx.Exec(ctx, `UPDATE forward_tasks SET status=CASE
		WHEN status='cancelled' THEN status
		WHEN done_count<target_count THEN status
		WHEN failed_count=0 AND skipped_count=0 THEN 'completed'
		WHEN success_count=0 THEN 'failed'
		ELSE 'partially_completed' END,
		finished_at=CASE WHEN done_count>=target_count THEN NOW() ELSE finished_at END,updated_at=NOW()
		WHERE id=$1::uuid`, taskID)
	return err
}

func (r *ForwardRepo) RecordAction(ctx context.Context, taskID, operatorID, action string, detail any) error {
	raw, _ := json.Marshal(detail)
	_, err := r.DB.Exec(ctx, `INSERT INTO forward_task_actions(task_id,admin_id,action,detail)
		VALUES($1::uuid,NULLIF($2,'')::uuid,$3,$4)`, taskID, operatorID, action, string(raw))
	return err
}
func recordActionTx(ctx context.Context, tx pgx.Tx, taskID, operatorID, action string, detail any) error {
	raw, _ := json.Marshal(detail)
	_, err := tx.Exec(ctx, `INSERT INTO forward_task_actions(task_id,admin_id,action,detail)
		VALUES($1::uuid,NULLIF($2,'')::uuid,$3,$4)`, taskID, operatorID, action, string(raw))
	return err
}
