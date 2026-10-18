package service

import (
	"context"
	"errors"
	"log"
	"time"

	"im-app-server/internal/media"
	"im-app-server/internal/repository"
)

var ErrRetentionAdapterUnavailable = errors.New("trusted OpenIM retention snapshot adapter is not installed")

type RetentionPlanningStore interface {
	EnqueueToday(context.Context, int) (int64, error)
	Claim(context.Context) (*repository.RetentionJob, error)
	SavePlan(context.Context, repository.RetentionJob, media.RetentionSnapshot) error
	Retry(context.Context, repository.RetentionJob, string) error
}

// Snapshot must be an authoritative, fixed committed watermark and complete
// classified history. SDK caches, allocated maxSeq and ordinary paged search do
// not meet this contract. visibility_only installs the private pinned adapter.
type RetentionSnapshotProvider interface {
	Snapshot(context.Context, string) (media.RetentionSnapshot, error)
}

type GroupRetentionScheduler struct{ Store RetentionPlanningStore }

// RunQueueOnly creates durable daily work, not plans or cleanup notifications.
// Database UTC dates, not individual host clocks, determine the daily boundary.
func (s *GroupRetentionScheduler) RunQueueOnly(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := s.Enqueue(ctx); err != nil && ctx.Err() == nil {
			log.Print("group retention queue failed; retrying next tick")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *GroupRetentionScheduler) Enqueue(ctx context.Context) error {
	for range 10 { // At most 2,000 new jobs/tick; remaining groups resume next tick.
		batchCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		n, err := s.Store.EnqueueToday(batchCtx, 200)
		cancel()
		if err != nil {
			return err
		}
		if n < 200 {
			return nil
		}
	}
	return nil
}

// PlanNext is called only by the explicitly gated visibility worker. A missing
// trusted adapter is rejected before leasing anything. This step only plans.
func (s *GroupRetentionScheduler) PlanNext(ctx context.Context, provider RetentionSnapshotProvider) (bool, error) {
	if provider == nil {
		return false, ErrRetentionAdapterUnavailable
	}
	job, err := s.Store.Claim(ctx)
	if err != nil || job == nil {
		return false, err
	}
	workCtx, cancel := context.WithTimeout(ctx, repository.RetentionLeaseTTL/2)
	defer cancel()
	snapshot, err := provider.Snapshot(workCtx, job.GroupID)
	code := "snapshot_unavailable"
	if err == nil {
		err = s.Store.SavePlan(workCtx, *job, snapshot)
		code = "snapshot_invalid"
		if errors.Is(err, repository.ErrRetentionPlanSize) {
			code = "plan_too_large"
		}
	}
	if err == nil {
		return true, nil
	}
	if errors.Is(err, repository.ErrRetentionLease) {
		return true, err
	}
	// A snapshot timeout must still be able to release/retry its live lease.
	retryCtx, retryCancel := context.WithTimeout(ctx, 5*time.Second)
	defer retryCancel()
	if retryErr := s.Store.Retry(retryCtx, *job, code); retryErr != nil {
		return true, retryErr
	}
	return true, errors.New("retention preview failed: " + code)
}
