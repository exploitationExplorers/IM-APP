package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"im-app-server/internal/media"
)

type RetentionVisibility struct {
	ConversationID string    `json:"conversationId"`
	MinVisibleSeq  int64     `json:"minVisibleSeq"`
	Revision       int64     `json:"revision"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type RetentionApplication struct {
	JobID      int64
	GroupID    string
	LeaseToken string
	Attempts   int
	Plan       media.RetentionPlan
}

// VisibilityForMember checks membership inside the SELECT, not in an earlier
// authorization query. Unauthorized/inactive groups and absent state are omitted.
// Historical boundaries remain readable even if the cleanup worker is disabled.
func (r *GroupRetentionRepo) VisibilityForMember(ctx context.Context, userID string, groupIDs []string) ([]RetentionVisibility, error) {
	result := make([]RetentionVisibility, 0)
	if len(groupIDs) == 0 || len(groupIDs) > 50 {
		return result, errors.New("retention query requires 1 to 50 groups")
	}
	rows, err := r.DB.Query(ctx, `SELECT g.id::text,v.min_visible_seq,v.revision,v.updated_at
		FROM group_retention_visibility v JOIN groups g ON g.id=v.group_id
		JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=$1::uuid
		JOIN users u ON u.id=gm.user_id AND COALESCE(u.status,'active')='active'
		WHERE g.id=ANY($2::uuid[]) AND COALESCE(g.status,'active')='active' ORDER BY g.id`, userID, groupIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item RetentionVisibility
		var groupID string
		if err := rows.Scan(&groupID, &item.MinVisibleSeq, &item.Revision, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.ConversationID = "sg_" + strings.ReplaceAll(groupID, "-", "")
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *GroupRetentionRepo) ClaimApplication(ctx context.Context) (*RetentionApplication, error) {
	// Bounded backfill supports enabling apply after several preview-only days.
	_, err := r.DB.Exec(ctx, `INSERT INTO group_retention_applications(job_id)
		SELECT j.id FROM group_retention_jobs j JOIN groups g ON g.id=j.group_id
		WHERE j.status='planned' AND COALESCE(g.status,'active')='active'
		AND (COALESCE(cardinality($1::uuid[]),0)=0 OR g.id=ANY($1::uuid[]))
		AND NOT EXISTS(SELECT 1 FROM group_retention_applications a WHERE a.job_id=j.id)
		ORDER BY j.id LIMIT 200 ON CONFLICT DO NOTHING`, r.GroupIDs)
	if err != nil {
		return nil, err
	}
	_, err = r.DB.Exec(ctx, `UPDATE group_retention_applications SET status='blocked',
		lease_token=NULL,locked_until=NULL,failure_code='attempts_exhausted',updated_at=NOW()
		WHERE status='applying' AND locked_until<=NOW() AND attempts>=8
		AND job_id IN (SELECT id FROM group_retention_jobs WHERE COALESCE(cardinality($1::uuid[]),0)=0 OR group_id=ANY($1::uuid[]))`, r.GroupIDs)
	if err != nil {
		return nil, err
	}
	a := &RetentionApplication{LeaseToken: uuid.NewString()}
	var raw []byte
	err = r.DB.QueryRow(ctx, `WITH picked AS (
		SELECT a.job_id FROM group_retention_applications a JOIN group_retention_jobs j ON j.id=a.job_id
		JOIN groups g ON g.id=j.group_id WHERE COALESCE(g.status,'active')='active' AND a.attempts<8 AND
		(COALESCE(cardinality($2::uuid[]),0)=0 OR g.id=ANY($2::uuid[])) AND
		((a.status IN ('queued','retry') AND a.next_attempt_at<=NOW()) OR (a.status='applying' AND a.locked_until<=NOW()))
		AND NOT EXISTS(SELECT 1 FROM group_retention_applications prev JOIN group_retention_jobs pj ON pj.id=prev.job_id
		 WHERE pj.group_id=j.group_id AND prev.job_id<a.job_id AND prev.status NOT IN ('applied','blocked'))
		ORDER BY a.job_id FOR UPDATE OF a SKIP LOCKED LIMIT 1)
		UPDATE group_retention_applications a SET status='applying',attempts=a.attempts+1,
		lease_token=$1::uuid,locked_until=NOW()+INTERVAL '2 minutes',updated_at=NOW()
		FROM picked,group_retention_jobs j WHERE a.job_id=picked.job_id AND j.id=a.job_id
		RETURNING a.job_id,j.group_id::text,a.attempts,j.plan`, a.LeaseToken, r.GroupIDs).
		Scan(&a.JobID, &a.GroupID, &a.Attempts, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &a.Plan); err != nil {
		return nil, err
	}
	return a, nil
}

// CompleteApplication must only follow an idempotent authoritative adapter's
// durable acknowledgement. It reloads the plan (not caller supplied candidates),
// fences stale leases and publishes the boundary in the same transaction as ACK.
// It does not delete any OSS object, and is not exposed as a user HTTP endpoint.
func (r *GroupRetentionRepo) CompleteApplication(ctx context.Context, application RetentionApplication, acknowledgedMinSeq int64) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	var groupID string
	err = tx.QueryRow(ctx, `SELECT j.plan,j.group_id::text FROM group_retention_applications a
		JOIN group_retention_jobs j ON j.id=a.job_id WHERE a.job_id=$1 AND a.lease_token=$2::uuid
		AND a.status='applying' AND a.locked_until>NOW() FOR UPDATE OF a`, application.JobID, application.LeaseToken).Scan(&raw, &groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRetentionLease
	}
	if err != nil {
		return err
	}
	var plan media.RetentionPlan
	if err := json.Unmarshal(raw, &plan); err != nil {
		return err
	}
	boundary, err := media.RetentionMinSeq(plan)
	if err != nil || acknowledgedMinSeq != boundary || groupID != application.GroupID || plan.ConversationID != "sg_"+strings.ReplaceAll(groupID, "-", "") {
		return media.ErrRetentionNonPrefix
	}
	if boundary > 0 {
		_, err = tx.Exec(ctx, `INSERT INTO group_retention_visibility(group_id,min_visible_seq) VALUES($1::uuid,$2)
			ON CONFLICT(group_id) DO UPDATE SET min_visible_seq=EXCLUDED.min_visible_seq,
			revision=group_retention_visibility.revision+1,updated_at=NOW()
			WHERE group_retention_visibility.min_visible_seq<EXCLUDED.min_visible_seq`, groupID, boundary)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE group_retention_applications SET status='applied',lease_token=NULL,
		locked_until=NULL,failure_code='',updated_at=NOW() WHERE job_id=$1`, application.JobID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRetentionRepo) RetryApplication(ctx context.Context, application RetentionApplication, code string) error {
	if code != "apply_failed" && code != "adapter_unavailable" && code != "non_prefix" {
		return errors.New("invalid retention apply failure code")
	}
	delay := 30 * (1 << min(max(application.Attempts-1, 0), 6))
	tag, err := r.DB.Exec(ctx, `UPDATE group_retention_applications SET
		status=CASE WHEN attempts>=8 OR $3='non_prefix' THEN 'blocked' ELSE 'retry' END,
		next_attempt_at=NOW()+($4*INTERVAL '1 second'),failure_code=$3,
		lease_token=NULL,locked_until=NULL,updated_at=NOW()
		WHERE job_id=$1 AND lease_token=$2::uuid AND status='applying' AND locked_until>NOW()`,
		application.JobID, application.LeaseToken, code, delay)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrRetentionLease
	}
	return nil
}
