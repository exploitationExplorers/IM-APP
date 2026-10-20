package media

import (
	"errors"
	"testing"
	"time"
)

func TestRetentionMinSeq(t *testing.T) {
	quota := GroupRetentionCount
	for _, n := range []int{0, quota - 1, quota, quota + 1, quota + 500} {
		s := retentionSnapshot(n)
		p, _ := planDefault(s)
		boundary, err := RetentionMinSeq(p)
		want := int64(0)
		if n > quota {
			want = int64((n - (quota - 1)) * 3)
		}
		if err != nil || boundary != want {
			t.Fatalf("n=%d boundary=%d want=%d err=%v", n, boundary, want, err)
		}
	}
	s := retentionSnapshot(3)
	for i := range s.Messages {
		s.Messages[i].SendTime = s.ServerTime.Add(-169 * time.Hour)
	}
	p, _ := planDefault(s)
	if got, err := RetentionMinSeq(p); err != nil || got != 10 {
		t.Fatal("all expired must stop at watermark+1", got, err)
	}
	// The adapter must never clear a whole conversation to handle a non-prefix.
	s.Messages[0].SendTime = s.ServerTime
	p, _ = planDefault(s)
	if _, err := RetentionMinSeq(p); !errors.Is(err, ErrRetentionNonPrefix) {
		t.Fatal("out-of-order time crossed a kept message")
	}
}
