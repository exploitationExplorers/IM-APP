package repository

import (
	"context"
	"encoding/json"
	"time"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	IMEventUserRegistered     = "user.registered"
	IMEventUserProfileUpdated = "user.profile_updated"
	IMEventFriendAccepted     = "friend.accepted"
	IMEventFriendDeleted      = "friend.deleted"
	IMEventBlockAdded         = "block.added"
	IMEventBlockRemoved       = "block.removed"
	IMEventGroupCreated       = "group.created"
	IMEventGroupUpdated       = "group.updated"
	IMEventGroupMemberJoined  = "group.member.joined"
	IMEventGroupMemberLeft    = "group.member.left"
	IMEventGroupMemberRole    = "group.member.role_changed"
	IMEventGroupMemberMute    = "group.member.mute_changed"
	IMEventGroupMemberProfile = "group.member.profile_changed"
	IMEventGroupMute          = "group.mute_changed"
	IMEventGroupDismissed     = "group.dismissed"
)

type IMSyncEvent struct {
	ID           int64
	AggregateID  string
	EventType    string
	Payload      json.RawMessage
	AttemptCount int
}

type IMSyncOutboxRepo struct {
	DB *pgxpool.Pool
}

func EnqueueIMSyncTx(ctx context.Context, tx pgx.Tx, eventType, userID string, payload any) error {
	return EnqueueIMSyncAggregateTx(ctx, tx, "user", userID, eventType, payload)
}

func EnqueueIMSyncAggregateTx(ctx context.Context, tx pgx.Tx, aggregateType, aggregateID, eventType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO im_sync_outbox(aggregate_type, aggregate_id, event_type, payload)
		VALUES($1, $2::uuid, $3, $4::jsonb)`, aggregateType, aggregateID, eventType, raw)
	return err
}

// ClaimBatch leases ready jobs. SKIP LOCKED allows multiple backend instances
// without processing the same registration event twice.
func (r *IMSyncOutboxRepo) ClaimBatch(ctx context.Context, workerID string, limit int) ([]IMSyncEvent, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.DB.Query(ctx, `
		WITH picked AS (
			SELECT id FROM im_sync_outbox
			WHERE (status IN ('pending', 'retry') AND next_attempt_at <= NOW())
			   OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
			ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1
		)
		UPDATE im_sync_outbox AS jobs
		SET status='processing', locked_at=NOW(), locked_by=$2,
			attempt_count=attempt_count+1, updated_at=NOW()
		FROM picked WHERE jobs.id=picked.id
		RETURNING jobs.id, jobs.aggregate_id::text, jobs.event_type,
			jobs.payload, jobs.attempt_count`, limit, workerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]IMSyncEvent, 0, limit)
	for rows.Next() {
		var event IMSyncEvent
		if err := rows.Scan(&event.ID, &event.AggregateID, &event.EventType, &event.Payload, &event.AttemptCount); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (r *IMSyncOutboxRepo) MarkCompleted(ctx context.Context, id int64, workerID string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE im_sync_outbox
		SET status='completed', completed_at=NOW(), updated_at=NOW(),
			locked_at=NULL, locked_by='', last_error=''
		WHERE id=$1 AND status='processing' AND locked_by=$2`, id, workerID)
	return err
}

func (r *IMSyncOutboxRepo) MarkFailed(ctx context.Context, event IMSyncEvent, workerID, message string, nextAttempt time.Time, maxAttempts int) error {
	status := "retry"
	if event.AttemptCount >= maxAttempts {
		status = "dead"
	}
	_, err := r.DB.Exec(ctx, `
		UPDATE im_sync_outbox
		SET status=$3, next_attempt_at=$4, last_error=$5,
			locked_at=NULL, locked_by='', updated_at=NOW()
		WHERE id=$1 AND status='processing' AND locked_by=$2`,
		event.ID, workerID, status, nextAttempt, message)
	return err
}

func (r *IMSyncOutboxRepo) StatusCounts(ctx context.Context) (pending, dead int64, err error) {
	err = r.DB.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status IN ('pending','processing','retry')),
			COUNT(*) FILTER (WHERE status='dead')
		FROM im_sync_outbox`).Scan(&pending, &dead)
	return pending, dead, err
}

// EnqueueReconciliation snapshots current PostgreSQL identities and relations.
// OpenIM operations are idempotent, so this endpoint can safely be run again
// after disaster recovery or manual changes on the OpenIM side.
func (r *IMSyncOutboxRepo) EnqueueReconciliation(ctx context.Context) (models.IMReconcileResult, error) {
	var result models.IMReconcileResult
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		INSERT INTO im_sync_outbox(aggregate_type, aggregate_id, event_type, payload)
		SELECT 'user', id, $1, jsonb_build_object('source','reconcile')
		FROM users WHERE COALESCE(status,'active')='active'`, IMEventUserProfileUpdated)
	if err != nil {
		return result, err
	}
	result.Users = tag.RowsAffected()

	tag, err = tx.Exec(ctx, `
		INSERT INTO im_sync_outbox(aggregate_type, aggregate_id, event_type, payload)
		SELECT 'user', f.user_id, $1,
			jsonb_build_object('friendUserId', f.friend_id::text, 'source', 'reconcile')
		FROM friendships f
		JOIN users owner ON owner.id=f.user_id AND COALESCE(owner.status,'active')='active'
		JOIN users friend ON friend.id=f.friend_id AND COALESCE(friend.status,'active')='active'
		WHERE f.user_id::text < f.friend_id::text`, IMEventFriendAccepted)
	if err != nil {
		return result, err
	}
	result.Friendships = tag.RowsAffected()

	tag, err = tx.Exec(ctx, `
		INSERT INTO im_sync_outbox(aggregate_type, aggregate_id, event_type, payload)
		SELECT 'user', b.user_id, $1,
			jsonb_build_object('blockedUserId', b.blocked_id::text, 'source', 'reconcile')
		FROM user_blocks b
		JOIN users owner ON owner.id=b.user_id AND COALESCE(owner.status,'active')='active'
		JOIN users blocked ON blocked.id=b.blocked_id AND COALESCE(blocked.status,'active')='active'`, IMEventBlockAdded)
	if err != nil {
		return result, err
	}
	result.Blocks = tag.RowsAffected()

	tag, err = tx.Exec(ctx, `
		INSERT INTO im_sync_outbox(aggregate_type, aggregate_id, event_type, payload)
		SELECT 'group', id, $1, jsonb_build_object('source','reconcile')
		FROM groups WHERE COALESCE(status,'active')='active'`, IMEventGroupCreated)
	if err != nil {
		return result, err
	}
	result.Groups = tag.RowsAffected()
	result.Total = result.Users + result.Friendships + result.Blocks + result.Groups
	if err := tx.Commit(ctx); err != nil {
		return models.IMReconcileResult{}, err
	}
	return result, nil
}

func (r *IMSyncOutboxRepo) List(ctx context.Context, status string, limit int) ([]models.IMOutboxItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := r.DB.Query(ctx, `
		SELECT id, aggregate_type, aggregate_id::text, event_type, payload,
			status, attempt_count, last_error, next_attempt_at, updated_at
		FROM im_sync_outbox
		WHERE ($1='' OR status=$1)
		ORDER BY id DESC LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]models.IMOutboxItem, 0)
	for rows.Next() {
		var item models.IMOutboxItem
		if err := rows.Scan(&item.ID, &item.AggregateType, &item.AggregateID, &item.EventType,
			&item.Payload, &item.Status, &item.AttemptCount, &item.LastError,
			&item.NextAttemptAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *IMSyncOutboxRepo) ReplayDead(ctx context.Context, id int64) (bool, error) {
	tag, err := r.DB.Exec(ctx, `
		UPDATE im_sync_outbox
		SET status='pending', attempt_count=0, next_attempt_at=NOW(),
			last_error='', locked_at=NULL, locked_by='', completed_at=NULL, updated_at=NOW()
		WHERE id=$1 AND status='dead'`, id)
	return err == nil && tag.RowsAffected() == 1, err
}

func (r *IMSyncOutboxRepo) RelationshipState(ctx context.Context, ownerID, otherID string) (friend, blocked bool, err error) {
	err = r.DB.QueryRow(ctx, `
		SELECT
			EXISTS(SELECT 1 FROM friendships WHERE user_id=$1::uuid AND friend_id=$2::uuid),
			EXISTS(SELECT 1 FROM user_blocks WHERE user_id=$1::uuid AND blocked_id=$2::uuid)`,
		ownerID, otherID).Scan(&friend, &blocked)
	return friend, blocked, err
}
