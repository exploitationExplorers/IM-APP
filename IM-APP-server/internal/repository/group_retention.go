package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"im-app-server/internal/media"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type publishedRetentionLimits struct {
	GroupRetentionMaxMessages int `json:"groupRetentionMaxMessages"`
	GroupRetentionHours       int `json:"groupRetentionHours"`
}

// EffectiveRetentionPolicy resolves per-group override → published system.limits → code defaults.
func (r *GroupRetentionRepo) EffectiveRetentionPolicy(ctx context.Context, groupID string) (media.RetentionPolicy, error) {
	policy := media.DefaultRetentionPolicy()
	var raw string
	_ = r.DB.QueryRow(ctx, `SELECT data_json FROM app_config_versions
		WHERE status='published' ORDER BY version DESC, id DESC LIMIT 1`).Scan(&raw)
	if raw != "" {
		var limits publishedRetentionLimits
		if json.Unmarshal([]byte(raw), &limits) == nil {
			if limits.GroupRetentionMaxMessages > 0 {
				policy.MaxMessages = limits.GroupRetentionMaxMessages
			}
			if limits.GroupRetentionHours > 0 {
				policy.Window = time.Duration(limits.GroupRetentionHours) * time.Hour
			}
		}
	}
	var maxMessages, keepHours *int
	err := r.DB.QueryRow(ctx, `SELECT retention_max_messages, retention_keep_hours
		FROM groups WHERE id=$1::uuid`, groupID).Scan(&maxMessages, &keepHours)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return media.RetentionPolicy{}, err
	}
	if maxMessages != nil && *maxMessages > 0 {
		policy.MaxMessages = *maxMessages
	}
	if keepHours != nil && *keepHours > 0 {
		policy.Window = time.Duration(*keepHours) * time.Hour
	}
	return media.NormalizeRetentionPolicy(policy), nil
}

// GlobalRetentionPolicy returns published system defaults (no per-group override).
func (r *GroupRetentionRepo) GlobalRetentionPolicy(ctx context.Context) media.RetentionPolicy {
	policy := media.DefaultRetentionPolicy()
	var raw string
	_ = r.DB.QueryRow(ctx, `SELECT data_json FROM app_config_versions
		WHERE status='published' ORDER BY version DESC, id DESC LIMIT 1`).Scan(&raw)
	if raw == "" {
		return policy
	}
	var limits publishedRetentionLimits
	if json.Unmarshal([]byte(raw), &limits) != nil {
		return policy
	}
	if limits.GroupRetentionMaxMessages > 0 {
		policy.MaxMessages = limits.GroupRetentionMaxMessages
	}
	if limits.GroupRetentionHours > 0 {
		policy.Window = time.Duration(limits.GroupRetentionHours) * time.Hour
	}
	return media.NormalizeRetentionPolicy(policy)
}

var (
	ErrRetentionLease    = errors.New("retention planning lease expired or replaced")
	ErrRetentionPlanSize = errors.New("retention preview plan exceeds storage limit")
)

const RetentionMaxAttempts = 8
const RetentionLeaseTTL = 2 * time.Minute

type RetentionJob struct {
	ID         int64
	GroupID    string
	LeaseToken string
	Attempts   int
}

// GroupRetentionRepo has no message/object deletion methods or cleanup cursor.
// Only the trusted private server adapter supplies snapshots to SavePlan.
type GroupRetentionRepo struct {
	DB *pgxpool.Pool
	// Scope applies to enqueue AND claims, including old queued/planned jobs.
	// Empty means all; configuration requires explicit all-groups opt-in before
	// starting the visibility worker. Published state reads remain unscoped.
	GroupIDs []string
}

// EnqueueToday uses database UTC time and a unique group/day constraint. The
// bounded anti-join also lets a restart/multiple API replicas continue safely.
func (r *GroupRetentionRepo) EnqueueToday(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 200 {
		limit = 200
	}
	tag, err := r.DB.Exec(ctx, `
		INSERT INTO group_retention_jobs(group_id,run_day)
		SELECT g.id, (NOW() AT TIME ZONE 'UTC')::date FROM groups g
		WHERE COALESCE(g.status,'active')='active'
		AND (COALESCE(cardinality($2::uuid[]),0)=0 OR g.id=ANY($2::uuid[])) AND NOT EXISTS (
			SELECT 1 FROM group_retention_jobs j WHERE j.group_id=g.id
			AND j.run_day=(NOW() AT TIME ZONE 'UTC')::date)
		ORDER BY g.id LIMIT $1 ON CONFLICT (group_id,run_day) DO NOTHING`, limit, r.GroupIDs)
	return tag.RowsAffected(), err
}

func (r *GroupRetentionRepo) Claim(ctx context.Context) (*RetentionJob, error) {
	// A worker that dies on its eighth attempt must not leave a permanent lease.
	if _, err := r.DB.Exec(ctx, `UPDATE group_retention_jobs SET status='blocked',
		lease_token=NULL,locked_until=NULL,failure_code='attempts_exhausted',updated_at=NOW()
		WHERE status='planning' AND locked_until<=NOW() AND attempts >= $1
		AND (COALESCE(cardinality($2::uuid[]),0)=0 OR group_id=ANY($2::uuid[]))`, RetentionMaxAttempts, r.GroupIDs); err != nil {
		return nil, err
	}
	job := &RetentionJob{LeaseToken: uuid.NewString()}
	err := r.DB.QueryRow(ctx, `
		WITH picked AS (
			SELECT j.id FROM group_retention_jobs j JOIN groups g ON g.id=j.group_id
			WHERE COALESCE(g.status,'active')='active' AND j.attempts<$1 AND
			 (COALESCE(cardinality($3::uuid[]),0)=0 OR g.id=ANY($3::uuid[])) AND
			 ((j.status IN ('queued','retry') AND j.next_attempt_at<=NOW()) OR
			  (j.status='planning' AND j.locked_until<=NOW()))
			ORDER BY j.run_day,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
		UPDATE group_retention_jobs j SET status='planning',attempts=attempts+1,
		 lease_token=$2::uuid,locked_until=NOW()+INTERVAL '2 minutes',updated_at=NOW()
		FROM picked WHERE j.id=picked.id RETURNING j.id,j.group_id::text,j.attempts`,
		RetentionMaxAttempts, job.LeaseToken, r.GroupIDs).Scan(&job.ID, &job.GroupID, &job.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return job, err
}

// SavePlan recomputes the pure plan, validates the group binding, and fences a
// stale worker. No message body, user token, URL or media content is persisted.
func (r *GroupRetentionRepo) SavePlan(ctx context.Context, job RetentionJob, snapshot media.RetentionSnapshot) error {
	if snapshot.ConversationID != "sg_"+strings.ReplaceAll(job.GroupID, "-", "") {
		return media.ErrRetentionSnapshot
	}
	policy, err := r.EffectiveRetentionPolicy(ctx, job.GroupID)
	if err != nil {
		return err
	}
	plan, err := media.PlanGroupRetention(snapshot, policy)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	// Reserve headroom for JSONB's whitespace expansion.
	if len(raw) > 2*1024*1024 {
		return ErrRetentionPlanSize
	}
	tag, err := r.DB.Exec(ctx, `UPDATE group_retention_jobs SET status='planned',plan=$3::jsonb,
		committed_watermark=$4,candidate_count=$5,failure_code='',lease_token=NULL,locked_until=NULL,updated_at=NOW()
		WHERE id=$1 AND lease_token=$2::uuid AND status='planning' AND locked_until>NOW() AND group_id=$6::uuid`,
		job.ID, job.LeaseToken, raw, plan.Watermark, len(plan.Candidates), job.GroupID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrRetentionLease
	}
	return nil
}

// Retry stores a bounded code, never an upstream exception/URL/credential.
func (r *GroupRetentionRepo) Retry(ctx context.Context, job RetentionJob, code string) error {
	if code != "snapshot_unavailable" && code != "snapshot_invalid" && code != "plan_too_large" {
		return errors.New("invalid retention failure code")
	}
	delay := time.Duration(1<<min(max(job.Attempts-1, 0), 6)) * 30 * time.Second
	tag, err := r.DB.Exec(ctx, `UPDATE group_retention_jobs SET
		status=CASE WHEN attempts >= $4 THEN 'blocked' ELSE 'retry' END,
		next_attempt_at=NOW()+($5 * INTERVAL '1 second'),failure_code=$3,
		lease_token=NULL,locked_until=NULL,updated_at=NOW()
		WHERE id=$1 AND lease_token=$2::uuid AND status='planning' AND locked_until>NOW()`,
		job.ID, job.LeaseToken, code, RetentionMaxAttempts, int(delay.Seconds()))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrRetentionLease
	}
	return nil
}
