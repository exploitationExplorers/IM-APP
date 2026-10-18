package repository_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"im-app-server/internal/media"
	"im-app-server/internal/repository"
)

func TestRetentionPostgresIntegration(t *testing.T) {
	pool := mediaTestPool(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `CREATE TABLE groups(id UUID PRIMARY KEY,status TEXT NOT NULL DEFAULT 'active');
		INSERT INTO groups(id) VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
		INSERT INTO groups VALUES('33333333-3333-4333-8333-333333333333','dismissed')`)
	if err != nil {
		t.Fatal(err)
	}
	ddl, err := os.ReadFile(filepath.Join("..", "..", "migrations", "054_group_retention_plans.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err = pool.Exec(ctx, string(ddl)); err != nil {
			t.Fatal(err)
		}
	}
	repo := &repository.GroupRetentionRepo{DB: pool}
	reset := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, "TRUNCATE group_retention_jobs RESTART IDENTITY"); err != nil {
			t.Fatal(err)
		}
	}
	claim := func() repository.RetentionJob {
		t.Helper()
		j, e := repo.Claim(ctx)
		if e != nil || j == nil {
			t.Fatal("claim failed", e)
		}
		return *j
	}
	snapshot := func(job repository.RetentionJob) media.RetentionSnapshot {
		now := time.Now().UTC()
		return media.RetentionSnapshot{ConversationID: "sg_" + strings.ReplaceAll(job.GroupID, "-", ""), SessionType: "group", ServerTime: now, Watermark: 3, Complete: true,
			Messages: []media.RetentionMessage{{Seq: 1, SendTime: now.Add(-169 * time.Hour), Visibility: "visible"}, {Seq: 3, SendTime: now, Visibility: "visible"}}}
	}

	t.Run("scoped_enqueue_and_claim_exclude_old_unscoped_backlog", func(t *testing.T) {
		reset()
		const allowed = "22222222-2222-4222-8222-222222222222"
		scoped := &repository.GroupRetentionRepo{DB: pool, GroupIDs: []string{allowed}}
		if n, e := scoped.EnqueueToday(ctx, 200); e != nil || n != 1 {
			t.Fatal(n, e)
		}
		if n, e := repo.EnqueueToday(ctx, 200); e != nil || n != 1 {
			t.Fatal(n, e)
		}
		j, e := scoped.Claim(ctx)
		if e != nil || j == nil || j.GroupID != allowed {
			t.Fatal("scope did not fence planning", j, e)
		}
		if e = scoped.SavePlan(ctx, *j, snapshot(*j)); e != nil {
			t.Fatal(e)
		}
		if j, e := scoped.Claim(ctx); e != nil || j != nil {
			t.Fatal("claimed another group's backlog", j, e)
		}
		if j, e := repo.Claim(ctx); e != nil || j == nil || j.GroupID == allowed {
			t.Fatal("outside backlog was modified", j, e)
		}
	})
	t.Run("stored_job_group_cannot_be_rebound_by_caller", func(t *testing.T) {
		reset()
		_, _ = repo.EnqueueToday(ctx, 200)
		j := claim()
		if j.GroupID == "11111111-1111-4111-8111-111111111111" {
			j.GroupID = "22222222-2222-4222-8222-222222222222"
		} else {
			j.GroupID = "11111111-1111-4111-8111-111111111111"
		}
		if e := repo.SavePlan(ctx, j, snapshot(j)); !errors.Is(e, repository.ErrRetentionLease) {
			t.Fatal("caller changed persisted job's group binding", e)
		}
	})
	t.Run("daily_idempotency_and_active_groups_only", func(t *testing.T) {
		reset()
		var wg sync.WaitGroup
		for range 6 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, e := repo.EnqueueToday(ctx, 200); e != nil {
					t.Error(e)
				}
			}()
		}
		wg.Wait()
		var n int
		_ = pool.QueryRow(ctx, "SELECT count(*) FROM group_retention_jobs").Scan(&n)
		if n != 2 {
			t.Fatalf("duplicate or dismissed jobs: %d", n)
		}
		_, _ = pool.Exec(ctx, "UPDATE group_retention_jobs SET run_day=run_day-1")
		if n, e := repo.EnqueueToday(ctx, 200); e != nil || n != 2 {
			t.Fatal("new UTC day not queued", n, e)
		}
	})
	t.Run("concurrent_claims_are_disjoint", func(t *testing.T) {
		reset()
		_, _ = repo.EnqueueToday(ctx, 200)
		var wg sync.WaitGroup
		var mu sync.Mutex
		seen := map[int64]bool{}
		for range 6 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				j, e := repo.Claim(ctx)
				if e != nil {
					t.Error(e)
					return
				}
				if j != nil {
					mu.Lock()
					defer mu.Unlock()
					if seen[j.ID] {
						t.Error("double lease")
					}
					seen[j.ID] = true
				}
			}()
		}
		wg.Wait()
		if len(seen) != 2 {
			t.Fatal("missing claims")
		}
	})
	t.Run("expired_lease_cannot_save_or_retry_after_reclaim", func(t *testing.T) {
		reset()
		_, _ = repo.EnqueueToday(ctx, 200)
		old := claim()
		_, _ = pool.Exec(ctx, "UPDATE group_retention_jobs SET locked_until=NOW()-INTERVAL '1 second' WHERE id=$1", old.ID)
		fresh := claim()
		if fresh.ID != old.ID || fresh.LeaseToken == old.LeaseToken || fresh.Attempts != 2 {
			t.Fatal("lease not replaced")
		}
		if e := repo.SavePlan(ctx, old, snapshot(old)); !errors.Is(e, repository.ErrRetentionLease) {
			t.Fatal("stale save allowed", e)
		}
		if e := repo.Retry(ctx, old, "snapshot_unavailable"); !errors.Is(e, repository.ErrRetentionLease) {
			t.Fatal("stale retry allowed", e)
		}
		if e := repo.SavePlan(ctx, fresh, snapshot(fresh)); e != nil {
			t.Fatal(e)
		}
		var state string
		var count int
		var raw []byte
		if e := pool.QueryRow(ctx, "SELECT status,candidate_count,plan FROM group_retention_jobs WHERE id=$1", fresh.ID).Scan(&state, &count, &raw); e != nil {
			t.Fatal(e)
		}
		var plan media.RetentionPlan
		if e := json.Unmarshal(raw, &plan); e != nil || state != "planned" || count != 1 || plan.Mode != "preview_only" || plan.Watermark != 3 {
			t.Fatal("plan persistence incorrect")
		}
	})
	t.Run("incomplete_or_cross_group_snapshot_rejected", func(t *testing.T) {
		reset()
		_, _ = repo.EnqueueToday(ctx, 200)
		job := claim()
		s := snapshot(job)
		s.Complete = false
		if e := repo.SavePlan(ctx, job, s); !errors.Is(e, media.ErrRetentionSnapshot) {
			t.Fatal(e)
		}
		s = snapshot(job)
		s.ConversationID = "sg_wrong"
		if e := repo.SavePlan(ctx, job, s); !errors.Is(e, media.ErrRetentionSnapshot) {
			t.Fatal(e)
		}
		var raw []byte
		_ = pool.QueryRow(ctx, "SELECT plan FROM group_retention_jobs WHERE id=$1", job.ID).Scan(&raw)
		if raw != nil {
			t.Fatal("invalid plan saved")
		}
	})
	t.Run("retry_backoff_and_terminal_limit", func(t *testing.T) {
		reset()
		_, _ = repo.EnqueueToday(ctx, 1)
		for attempt := 1; attempt <= repository.RetentionMaxAttempts; attempt++ {
			job := claim()
			if job.Attempts != attempt {
				t.Fatal("attempt progress lost")
			}
			if e := repo.Retry(ctx, job, "snapshot_unavailable"); e != nil {
				t.Fatal(e)
			}
			if j, e := repo.Claim(ctx); j != nil || e != nil {
				t.Fatal("backoff not respected")
			}
			_, _ = pool.Exec(ctx, "UPDATE group_retention_jobs SET next_attempt_at=NOW()-INTERVAL '1 second'")
		}
		var state string
		_ = pool.QueryRow(ctx, "SELECT status FROM group_retention_jobs").Scan(&state)
		if state != "blocked" {
			t.Fatal("attempt limit not enforced")
		}
	})
	t.Run("worker_crash_on_last_attempt_becomes_blocked", func(t *testing.T) {
		reset()
		_, _ = repo.EnqueueToday(ctx, 1)
		job := claim()
		_, _ = pool.Exec(ctx, "UPDATE group_retention_jobs SET attempts=8,locked_until=NOW()-INTERVAL '1 second' WHERE id=$1", job.ID)
		if j, e := repo.Claim(ctx); j != nil || e != nil {
			t.Fatal("dead last lease reclaimed")
		}
		var state string
		_ = pool.QueryRow(ctx, "SELECT status FROM group_retention_jobs").Scan(&state)
		if state != "blocked" {
			t.Fatal("dead job stuck planning")
		}
	})
}
