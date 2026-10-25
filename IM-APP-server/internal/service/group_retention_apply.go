package service

import (
	"context"
	"errors"
	"time"

	"im-app-server/internal/media"
	"im-app-server/internal/repository"
)

type RetentionApplyStore interface {
	ClaimApplication(context.Context) (*repository.RetentionApplication, error)
	CompleteApplication(context.Context, repository.RetentionApplication, int64) error
	RetryApplication(context.Context, repository.RetentionApplication, string) error
}

// ApplyPrefix must durably and monotonically advance authoritative OpenIM
// history bounds, repair member read/unread/last-message state, then acknowledge.
// Retries after a timeout/crash MUST be safe, even with an expired worker lease.
// A naked DeleteMsgsPhysicalBySeqs or ClearConversation is not this adapter.
type RetentionApplyProvider interface {
	ApplyPrefix(context.Context, repository.RetentionApplication, int64) error
}

type GroupRetentionApplier struct{ Store RetentionApplyStore }

func (s *GroupRetentionApplier) ApplyNext(ctx context.Context, provider RetentionApplyProvider) (bool, error) {
	if provider == nil {
		return false, ErrRetentionAdapterUnavailable
	}
	a, err := s.Store.ClaimApplication(ctx)
	if err != nil || a == nil {
		return false, err
	}
	boundary, err := media.RetentionMinSeq(a.Plan)
	code := "non_prefix"
	if err == nil {
		workCtx, cancel := context.WithTimeout(ctx, repository.RetentionLeaseTTL/2)
		defer cancel()
		if boundary > 0 {
			err = provider.ApplyPrefix(workCtx, *a, boundary)
		}
		code = "apply_failed"
		if err == nil {
			err = s.Store.CompleteApplication(workCtx, *a, boundary)
		}
	}
	if err == nil || errors.Is(err, repository.ErrRetentionLease) {
		return true, err
	}
	retryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if retryErr := s.Store.RetryApplication(retryCtx, *a, code); retryErr != nil {
		return true, retryErr
	}
	return true, errors.New("retention apply failed: " + code)
}
