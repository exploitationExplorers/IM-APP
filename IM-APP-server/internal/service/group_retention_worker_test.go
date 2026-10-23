package service

import (
	"context"
	"errors"
	"testing"

	"im-app-server/internal/repository"
)

type retentionApplyStoreStub struct {
	claims      int
	completed   int
	retried     string
	application *repository.RetentionApplication
	completeErr error
}

func (s *retentionApplyStoreStub) ClaimApplication(context.Context) (*repository.RetentionApplication, error) {
	s.claims++
	return s.application, nil
}
func (s *retentionApplyStoreStub) CompleteApplication(context.Context, repository.RetentionApplication, int64) error {
	s.completed++
	return s.completeErr
}
func (s *retentionApplyStoreStub) RetryApplication(_ context.Context, _ repository.RetentionApplication, code string) error {
	s.retried = code
	return nil
}

type retentionWorkerProviderStub struct {
	retentionProviderStub
	checks   int
	checkErr error
	applies  int
	applyErr error
}

func (s *retentionWorkerProviderStub) Check(context.Context) error { s.checks++; return s.checkErr }
func (s *retentionWorkerProviderStub) ApplyPrefix(context.Context, repository.RetentionApplication, int64) error {
	s.applies++
	return s.applyErr
}

func TestRetentionWorkerCapabilityGateAndBoundedWork(t *testing.T) {
	planStore := &retentionStoreStub{}
	applyStore := &retentionApplyStoreStub{}
	p := &retentionWorkerProviderStub{checkErr: errors.New("incompatible extension")}
	w := &GroupRetentionWorker{Scheduler: &GroupRetentionScheduler{Store: planStore}, Applier: &GroupRetentionApplier{Store: applyStore}, Provider: p}
	if err := w.Tick(context.Background()); err == nil || planStore.calls != 0 || planStore.claimed != 0 || applyStore.claims != 0 {
		t.Fatal("capability check did not gate all work")
	}
	p.checkErr = nil
	if err := w.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if planStore.claimed != 20 || applyStore.claims != 20 || planStore.saved != 20 || p.applies != 0 {
		t.Fatal("unbounded worker or unexpected apply")
	}
	w.Provider = nil
	if err := w.Tick(context.Background()); !errors.Is(err, ErrRetentionAdapterUnavailable) {
		t.Fatal(err)
	}
}

func TestRetentionApplyMissingAdapterAndNoCandidates(t *testing.T) {
	s := &retentionApplyStoreStub{}
	a := &GroupRetentionApplier{Store: s}
	if did, err := a.ApplyNext(context.Background(), nil); did || !errors.Is(err, ErrRetentionAdapterUnavailable) || s.claims != 0 {
		t.Fatal("claimed without provider")
	}
	s.application = &repository.RetentionApplication{}
	s.application.Plan.Mode = "preview_only"
	p := &retentionWorkerProviderStub{}
	if did, err := a.ApplyNext(context.Background(), p); !did || err != nil || p.applies != 0 || s.completed != 1 {
		t.Fatal("empty plan called adapter or failed to ACK")
	}
	s.completeErr = repository.ErrRetentionLease
	if _, err := a.ApplyNext(context.Background(), p); !errors.Is(err, repository.ErrRetentionLease) || s.retried != "" {
		t.Fatal("stale application retried with a replaced lease")
	}
}

func TestRetentionWorkerGroupFailureDoesNotStarveLaterRows(t *testing.T) {
	store := &retentionStoreStub{}
	applications := &retentionApplyStoreStub{}
	provider := &retentionWorkerProviderStub{retentionProviderStub: retentionProviderStub{err: errors.New("one group's persisted tail is incomplete")}}
	w := &GroupRetentionWorker{Scheduler: &GroupRetentionScheduler{Store: store}, Applier: &GroupRetentionApplier{Store: applications}, Provider: provider}
	if err := w.Tick(context.Background()); err == nil {
		t.Fatal("row failures hidden")
	}
	if store.claimed != 20 || applications.claims != 20 || store.retried != "snapshot_unavailable" {
		t.Fatal("one failed row starved the bounded pass")
	}
}
