package repository_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"im-app-server/internal/media"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
)

type retentionApplySpy struct {
	calls int
	fail  bool
}

func (s *retentionApplySpy) ApplyPrefix(_ context.Context, _ repository.RetentionApplication, _ int64) error {
	s.calls++
	if s.fail {
		return errors.New("private upstream error")
	}
	return nil
}

func TestRetentionVisibilityPostgresIntegration(t *testing.T) {
	pool := mediaTestPool(t)
	ctx := context.Background()
	const g = "11111111-1111-4111-8111-111111111111"
	const other = "22222222-2222-4222-8222-222222222222"
	const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const stranger = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	_, err := pool.Exec(ctx, `CREATE TABLE groups(id UUID PRIMARY KEY,status TEXT NOT NULL DEFAULT 'active');
		ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
		CREATE TABLE group_members(group_id UUID,user_id UUID,PRIMARY KEY(group_id,user_id));
		INSERT INTO groups(id) VALUES('`+g+`'),('`+other+`');
		INSERT INTO users(id) VALUES('`+user+`'),('`+stranger+`');
		INSERT INTO group_members VALUES('`+g+`','`+user+`');`)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"054_group_retention_plans.sql", "055_group_retention_visibility.sql"} {
		ddl, e := os.ReadFile(filepath.Join("..", "..", "migrations", file))
		if e != nil {
			t.Fatal(e)
		}
		for range 2 {
			if _, e = pool.Exec(ctx, string(ddl)); e != nil {
				t.Fatal(e)
			}
		}
	}
	r := &repository.GroupRetentionRepo{DB: pool}
	reset := func() {
		t.Helper()
		if _, e := pool.Exec(ctx, "TRUNCATE group_retention_visibility,group_retention_jobs RESTART IDENTITY CASCADE"); e != nil {
			t.Fatal(e)
		}
	}
	plan := func(group string, boundary int64) {
		t.Helper()
		now := time.Now().UTC()
		_, e := pool.Exec(ctx, `INSERT INTO group_retention_jobs(group_id,run_day) VALUES($1::uuid,(NOW() AT TIME ZONE 'UTC')::date)`, group)
		if e != nil {
			t.Fatal(e)
		}
		j, e := r.Claim(ctx)
		if e != nil || j == nil || j.GroupID != group {
			t.Fatal("claim", j, e)
		}
		s := media.RetentionSnapshot{ConversationID: "sg_" + strings.ReplaceAll(group, "-", ""), SessionType: "group", ServerTime: now, Watermark: boundary + 10, Complete: true,
			Messages: []media.RetentionMessage{{Seq: 1, SendTime: now.Add(-169 * time.Hour), Visibility: "visible"}, {Seq: boundary, SendTime: now, Visibility: "visible"}}}
		if e = r.SavePlan(ctx, *j, s); e != nil {
			t.Fatal(e)
		}
	}
	claim := func() *repository.RetentionApplication {
		t.Helper()
		a, e := r.ClaimApplication(ctx)
		if e != nil || a == nil {
			t.Fatal(a, e)
		}
		return a
	}
	visible := func(who string) []repository.RetentionVisibility {
		t.Helper()
		v, e := r.VisibilityForMember(ctx, who, []string{g, other})
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	t.Run("scope_fences_application_backfill_and_old_jobs_not_visibility_reads", func(t *testing.T) {
		reset()
		plan(g, 100)
		plan(other, 100)
		scoped := &repository.GroupRetentionRepo{DB: pool, GroupIDs: []string{other}}
		a, e := scoped.ClaimApplication(ctx)
		if e != nil || a == nil || a.GroupID != other {
			t.Fatal("scope did not fence application", a, e)
		}
		if e := scoped.CompleteApplication(ctx, *a, 100); e != nil {
			t.Fatal(e)
		}
		if a, e := scoped.ClaimApplication(ctx); e != nil || a != nil {
			t.Fatal("scope claimed outside backlog", a, e)
		}
		var outside int
		if e := pool.QueryRow(ctx, `SELECT COUNT(*) FROM group_retention_applications a JOIN group_retention_jobs j ON j.id=a.job_id WHERE j.group_id=$1`, g).Scan(&outside); e != nil || outside != 0 {
			t.Fatal("scope backfilled outside group", outside, e)
		}
		unscoped := claim()
		if unscoped.GroupID != g {
			t.Fatal("outside plan was modified")
		}
		if e := r.CompleteApplication(ctx, *unscoped, 100); e != nil {
			t.Fatal(e)
		}
		states, e := scoped.VisibilityForMember(ctx, user, []string{g})
		if e != nil || len(states) != 1 || states[0].MinVisibleSeq != 100 {
			t.Fatal("scope change hid durable old tombstone", states, e)
		}
	})
	t.Run("preview_never_publishes_and_missing_adapter_never_claims", func(t *testing.T) {
		reset()
		plan(g, 100)
		if len(visible(user)) != 0 {
			t.Fatal("preview published")
		}
		s := &service.GroupRetentionApplier{Store: r}
		if claimed, e := s.ApplyNext(ctx, nil); claimed || !errors.Is(e, service.ErrRetentionAdapterUnavailable) {
			t.Fatal(claimed, e)
		}
		var n int
		_ = pool.QueryRow(ctx, "SELECT COUNT(*) FROM group_retention_applications").Scan(&n)
		if n != 0 {
			t.Fatal("missing adapter created work")
		}
	})
	t.Run("failed_apply_retries_without_publishing", func(t *testing.T) {
		reset()
		plan(g, 100)
		spy := &retentionApplySpy{fail: true}
		s := &service.GroupRetentionApplier{Store: r}
		if claimed, e := s.ApplyNext(ctx, spy); !claimed || e == nil {
			t.Fatal(claimed, e)
		}
		if len(visible(user)) != 0 {
			t.Fatal("failed apply published")
		}
		_, _ = pool.Exec(ctx, "UPDATE group_retention_applications SET next_attempt_at=NOW()-INTERVAL '1 second'")
		spy.fail = false
		if claimed, e := s.ApplyNext(ctx, spy); !claimed || e != nil {
			t.Fatal(claimed, e)
		}
		v := visible(user)
		if spy.calls != 2 || len(v) != 1 || v[0].MinVisibleSeq != 100 || v[0].Revision != 1 {
			t.Fatal(v, spy.calls)
		}
		if claimed, e := s.ApplyNext(ctx, spy); claimed || e != nil {
			t.Fatal("completed job reapplied", claimed, e)
		}
	})
	t.Run("ack_boundary_lease_and_stored_group_are_fenced", func(t *testing.T) {
		reset()
		plan(g, 100)
		a := claim()
		if e := r.CompleteApplication(ctx, *a, 101); !errors.Is(e, media.ErrRetentionNonPrefix) {
			t.Fatal("bad ack accepted", e)
		}
		if len(visible(user)) != 0 {
			t.Fatal("bad ack published")
		}
		_, _ = pool.Exec(ctx, "UPDATE group_retention_applications SET locked_until=NOW()-INTERVAL '1 second'")
		b := claim()
		if a.LeaseToken == b.LeaseToken {
			t.Fatal("lease reused")
		}
		if e := r.CompleteApplication(ctx, *a, 100); !errors.Is(e, repository.ErrRetentionLease) {
			t.Fatal("old worker published", e)
		}
		if e := r.RetryApplication(ctx, *a, "apply_failed"); !errors.Is(e, repository.ErrRetentionLease) {
			t.Fatal(e)
		}
		forged := *b
		forged.GroupID = other
		if e := r.CompleteApplication(ctx, forged, 100); !errors.Is(e, media.ErrRetentionNonPrefix) {
			t.Fatal("wrong group accepted")
		}
		if e := r.CompleteApplication(ctx, *b, 100); e != nil {
			t.Fatal(e)
		}
	})
	t.Run("monotonic_boundary_and_member_authorization", func(t *testing.T) {
		reset()
		plan(g, 100)
		a := claim()
		if e := r.CompleteApplication(ctx, *a, 100); e != nil {
			t.Fatal(e)
		}
		if len(visible(stranger)) != 0 {
			t.Fatal("stranger read state")
		}
		_, _ = pool.Exec(ctx, "UPDATE group_retention_jobs SET run_day=run_day-1")
		plan(g, 50)
		a = claim()
		if e := r.CompleteApplication(ctx, *a, 50); e != nil {
			t.Fatal(e)
		}
		v := visible(user)
		if v[0].MinVisibleSeq != 100 || v[0].Revision != 1 {
			t.Fatal("state regressed", v)
		}
		_, _ = pool.Exec(ctx, "UPDATE group_retention_jobs SET run_day=run_day-1")
		plan(g, 200)
		a = claim()
		if e := r.CompleteApplication(ctx, *a, 200); e != nil {
			t.Fatal(e)
		}
		v = visible(user)
		if v[0].MinVisibleSeq != 200 || v[0].Revision != 2 {
			t.Fatal(v)
		}
		_, _ = pool.Exec(ctx, "UPDATE users SET status='disabled' WHERE id=$1", user)
		if len(visible(user)) != 0 {
			t.Fatal("disabled user read state")
		}
		_, _ = pool.Exec(ctx, "UPDATE users SET status='active' WHERE id=$1", user)
		_, _ = pool.Exec(ctx, "DELETE FROM group_members WHERE user_id=$1", user)
		if len(visible(user)) != 0 {
			t.Fatal("former member read state")
		}
		_, _ = pool.Exec(ctx, "INSERT INTO group_members VALUES($1,$2)", g, user)
	})
	t.Run("last_attempt_crash_blocks_without_publication", func(t *testing.T) {
		reset()
		plan(g, 100)
		_ = claim()
		_, _ = pool.Exec(ctx, "UPDATE group_retention_applications SET attempts=8,locked_until=NOW()-INTERVAL '1 second'")
		if a, e := r.ClaimApplication(ctx); a != nil || e != nil {
			t.Fatal(a, e)
		}
		var status string
		_ = pool.QueryRow(ctx, "SELECT status FROM group_retention_applications").Scan(&status)
		if status != "blocked" || len(visible(user)) != 0 {
			t.Fatal(status)
		}
	})
}
