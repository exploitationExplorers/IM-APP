package service

import (
	"context"
	"errors"
	"testing"

	"im-app-server/internal/media"
	"im-app-server/internal/repository"
)

type retentionStoreStub struct {
	calls    int
	claimed  int
	saved    int
	retried  string
	snapshot media.RetentionSnapshot
	saveErr  error
	batches  []int64
}

func (s *retentionStoreStub) EnqueueToday(context.Context, int) (int64, error) {
	s.calls++
	if len(s.batches) > 0 {
		n := s.batches[0]
		s.batches = s.batches[1:]
		return n, nil
	}
	return 0, nil
}
func (s *retentionStoreStub) Claim(context.Context) (*repository.RetentionJob, error) {
	s.claimed++
	return &repository.RetentionJob{ID: 1, GroupID: "group"}, nil
}
func (s *retentionStoreStub) SavePlan(_ context.Context, _ repository.RetentionJob, snapshot media.RetentionSnapshot) error {
	s.saved++
	s.snapshot = snapshot
	return s.saveErr
}
func (s *retentionStoreStub) Retry(_ context.Context, _ repository.RetentionJob, code string) error {
	s.retried = code
	return nil
}

type retentionProviderStub struct{ err error }

func (p retentionProviderStub) Snapshot(_ context.Context, _ string, _ media.RetentionPolicy) (media.RetentionSnapshot, error) {
	return media.RetentionSnapshot{Complete: true}, p.err
}

func TestRetentionQueueBatchesBounded(t *testing.T) {
	s := &retentionStoreStub{batches: []int64{200, 200, 1}}
	if err := (&GroupRetentionScheduler{Store: s}).Enqueue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s.calls != 3 || s.claimed != 0 {
		t.Fatal("queue must only enqueue")
	}
	s = &retentionStoreStub{batches: make([]int64, 12)}
	for i := range s.batches {
		s.batches[i] = 200
	}
	_ = (&GroupRetentionScheduler{Store: s}).Enqueue(context.Background())
	if s.calls != 10 {
		t.Fatal("unbounded work per tick")
	}
}

func TestRetentionPlanNeedsTrustedAdapter(t *testing.T) {
	s := &retentionStoreStub{}
	did, err := (&GroupRetentionScheduler{Store: s}).PlanNext(context.Background(), nil)
	if did || !errors.Is(err, ErrRetentionAdapterUnavailable) || s.claimed != 0 {
		t.Fatal("missing adapter must fail before claim")
	}
}

func TestRetentionPlanFailureCodesAndLeaseFence(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		sourceErr, errorOnSave error
		code                   string
	}{
		{"source", errors.New("sensitive upstream URL/token"), nil, "snapshot_unavailable"},
		{"invalid", nil, media.ErrRetentionSnapshot, "snapshot_invalid"},
		{"oversize", nil, repository.ErrRetentionPlanSize, "plan_too_large"},
		{"stale", nil, repository.ErrRetentionLease, ""},
		{"success", nil, nil, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &retentionStoreStub{saveErr: tc.errorOnSave}
			did, err := (&GroupRetentionScheduler{Store: s}).PlanNext(context.Background(), retentionProviderStub{err: tc.sourceErr})
			if !did || s.retried != tc.code {
				t.Fatalf("incorrect retry: %+v", s)
			}
			if tc.name == "success" && (err != nil || s.saved != 1) {
				t.Fatal("plan not saved")
			}
			if tc.name != "success" && err == nil {
				t.Fatal("failure hidden")
			}
			if tc.sourceErr != nil && s.saved != 0 {
				t.Fatal("saved failed snapshot")
			}
		})
	}
}
