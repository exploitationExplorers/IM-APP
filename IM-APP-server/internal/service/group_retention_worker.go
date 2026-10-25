package service

import (
	"context"
	"errors"
	"log"
	"time"
)

type RetentionProvider interface {
	RetentionSnapshotProvider
	RetentionApplyProvider
	Check(context.Context) error
}

type GroupRetentionWorker struct {
	Scheduler *GroupRetentionScheduler
	Applier   *GroupRetentionApplier
	Provider  RetentionProvider
}

// Tick is bounded and sequential; SQL leases permit several API replicas. A
// capability/version failure stops before enqueue/claim. Disabling the worker
// never rolls back a published bound or deletes a source object.
func (w *GroupRetentionWorker) Tick(ctx context.Context) error {
	if w.Provider == nil {
		return ErrRetentionAdapterUnavailable
	}
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := w.Provider.Check(checkCtx)
	cancel()
	if err != nil {
		return err
	}
	if err := w.Scheduler.Enqueue(ctx); err != nil {
		return err
	}
	var failures error
	for range 20 {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		planned, planErr := w.Scheduler.PlanNext(ctx, w.Provider)
		applied, applyErr := w.Applier.ApplyNext(ctx, w.Provider)
		failures = errors.Join(failures, planErr, applyErr)
		// A failed claimed row has its own durable backoff. Continue with other
		// groups instead of allowing one bad history/source to starve the pass.
		// A failure before claiming indicates a shared store error: stop the pass.
		if (planErr != nil && !planned) || (applyErr != nil && !applied) {
			return failures
		}
		if !planned && !applied {
			return failures
		}
	}
	return failures
}

func (w *GroupRetentionWorker) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := w.Tick(ctx); err != nil && ctx.Err() == nil {
			log.Print("group retention visibility pass failed; bounded retry scheduled (no source file deletion)")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
