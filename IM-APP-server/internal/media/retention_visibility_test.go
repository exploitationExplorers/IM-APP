package media

import (
	"errors"
	"testing"
	"time"
)

func TestRetentionMinSeq(t *testing.T) {
	quota := GroupRetentionCount
	// Within window → nothing to remove even past quota.
	for _, n := range []int{0, 1, quota - 1, quota, quota + 1, quota + 500} {
		s := retentionSnapshot(n)
		p, _ := planDefault(s)
		boundary, err := RetentionMinSeq(p)
		if err != nil || boundary != 0 {
			t.Fatalf("n=%d boundary=%d want=0 err=%v", n, boundary, err)
		}
	}
	// Under quota, all expired → still kept (union); boundary stays 0.
	s := retentionSnapshot(3)
	for i := range s.Messages {
		s.Messages[i].SendTime = s.ServerTime.Add(-(GroupRetentionWindow + time.Hour))
	}
	p, _ := planDefault(s)
	if got, err := RetentionMinSeq(p); err != nil || got != 0 {
		t.Fatal("under quota expired must keep", got, err)
	}
	// Over quota and all expired → removable prefix up to newest kept.
	s = retentionSnapshot(quota + 2)
	for i := range s.Messages {
		s.Messages[i].SendTime = s.ServerTime.Add(-(GroupRetentionWindow + time.Hour))
	}
	p, _ = planDefault(s)
	boundary, err := RetentionMinSeq(p)
	want := int64((2 + 1) * 3) // first kept seq among newest quota
	if err != nil || boundary != want {
		t.Fatalf("over-quota expired boundary=%d want=%d err=%v kept=%v", boundary, want, err, p.Kept)
	}
	// The adapter must never clear a whole conversation to handle a non-prefix.
	s.Messages[0].SendTime = s.ServerTime
	p, _ = planDefault(s)
	if _, err := RetentionMinSeq(p); !errors.Is(err, ErrRetentionNonPrefix) {
		t.Fatal("out-of-order time crossed a kept message")
	}
}
