package media

import (
	"errors"
	"testing"
	"time"
)

func TestRetentionMinSeq(t *testing.T) {
	for _, n := range []int{0, 499, 500, 501, 1000} {
		s := retentionSnapshot(n)
		p, _ := PlanGroupRetention(s)
		boundary, err := RetentionMinSeq(p)
		want := int64(0)
		if n > 500 {
			want = int64((n - 499) * 3)
		}
		if err != nil || boundary != want {
			t.Fatalf("n=%d boundary=%d want=%d err=%v", n, boundary, want, err)
		}
	}
	s := retentionSnapshot(3)
	for i := range s.Messages {
		s.Messages[i].SendTime = s.ServerTime.Add(-169 * time.Hour)
	}
	p, _ := PlanGroupRetention(s)
	if got, err := RetentionMinSeq(p); err != nil || got != 10 {
		t.Fatal("all expired must stop at watermark+1", got, err)
	}
	// The adapter must never clear a whole conversation to handle a non-prefix.
	s.Messages[0].SendTime = s.ServerTime
	p, _ = PlanGroupRetention(s)
	if _, err := RetentionMinSeq(p); !errors.Is(err, ErrRetentionNonPrefix) {
		t.Fatal("out-of-order time crossed a kept message")
	}
}
