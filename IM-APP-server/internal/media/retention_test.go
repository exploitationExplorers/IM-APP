package media

import (
	"reflect"
	"testing"
	"time"
)

func retentionSnapshot(n int) RetentionSnapshot {
	now := time.Date(2026, 10, 18, 3, 0, 0, 0, time.FixedZone("CST", 8*3600))
	s := RetentionSnapshot{ConversationID: "sg_example", SessionType: "group", ServerTime: now, Complete: true}
	for i := 1; i <= n; i++ {
		// Gaps simulate withdrawn/deleted sequence slots.
		s.Messages = append(s.Messages, RetentionMessage{Seq: int64(i * 3), SendTime: now.Add(-time.Hour), Visibility: "visible"})
	}
	s.Watermark = int64(n * 3)
	return s
}

func TestRetentionActualVisibleCount(t *testing.T) {
	for _, n := range []int{0, 1, 499, 500, 501, 1000} {
		s := retentionSnapshot(n)
		before := append([]RetentionMessage(nil), s.Messages...)
		p, err := PlanGroupRetention(s)
		if err != nil || len(p.Kept) != min(n, 500) || len(p.Candidates) != max(n-500, 0) {
			t.Fatalf("n=%d: %+v %v", n, p, err)
		}
		if !reflect.DeepEqual(s.Messages, before) {
			t.Fatal("planner mutated source snapshot")
		}
		if n > 500 && p.Candidates[0].Seq != 3 {
			t.Fatal("sequence arithmetic replaced actual counting")
		}
	}
}

func TestRetentionRollingWindowAndBoundary(t *testing.T) {
	s := retentionSnapshot(4)
	cutoff := s.ServerTime.Add(-7 * 24 * time.Hour)
	s.Messages[0].SendTime = cutoff.Add(-time.Nanosecond)
	s.Messages[1].SendTime = cutoff
	s.Messages[2].SendTime = cutoff.Add(time.Nanosecond)
	p, err := PlanGroupRetention(s)
	if err != nil || !reflect.DeepEqual(p.Kept, []int64{6, 9, 12}) || len(p.Candidates) != 1 || !p.Candidates[0].OverAge || p.Candidates[0].OverCount {
		t.Fatalf("boundary: %+v %v", p, err)
	}
	for i := range s.Messages {
		s.Messages[i].SendTime = cutoff.Add(-time.Second)
	}
	p, err = PlanGroupRetention(s)
	if err != nil || len(p.Kept) != 0 || len(p.Candidates) != 4 {
		t.Fatal("under 500 incorrectly preserved old messages")
	}
}

func TestRetentionSnapshotIsolationAndNotices(t *testing.T) {
	s := retentionSnapshot(501)
	s.Messages[0].Visibility = "hidden"
	// A displayed system notice is explicitly classified visible, like text.
	s.Messages = append(s.Messages, RetentionMessage{Seq: s.Watermark + 1, SendTime: s.ServerTime.Add(time.Second), Visibility: "visible"})
	p, err := PlanGroupRetention(s)
	if err != nil || len(p.Kept) != 500 || len(p.Candidates) != 0 || p.HiddenCount != 1 || p.AfterWatermarkCount != 1 {
		t.Fatalf("snapshot: %+v %v", p, err)
	}
	// Unsorted server pages yield the same plan.
	s.Messages[1], s.Messages[500] = s.Messages[500], s.Messages[1]
	q, err := PlanGroupRetention(s)
	if err != nil || !reflect.DeepEqual(p, q) {
		t.Fatal("pagination order changes retention")
	}
	other := retentionSnapshot(1)
	other.ConversationID = "sg_other"
	q, err = PlanGroupRetention(other)
	if err != nil || q.ConversationID == p.ConversationID || len(q.Kept) != 1 {
		t.Fatal("group scopes conflated")
	}
}

func TestRetentionRejectsUntrustedOrIncompleteInput(t *testing.T) {
	for _, mutate := range []func(*RetentionSnapshot){
		func(s *RetentionSnapshot) { s.Complete = false },
		func(s *RetentionSnapshot) { s.SessionType = "c2c" },
		func(s *RetentionSnapshot) { s.ConversationID = "si_private" },
		func(s *RetentionSnapshot) { s.ServerTime = time.Time{} },
		func(s *RetentionSnapshot) { s.Watermark = -1 },
		func(s *RetentionSnapshot) { s.Messages[0].Seq = 0 },
		func(s *RetentionSnapshot) { s.Messages = append(s.Messages, s.Messages[0]) },
		func(s *RetentionSnapshot) { s.Messages[0].Visibility = "unknown" },
		func(s *RetentionSnapshot) { s.Messages[0].SendTime = time.Time{} },
		func(s *RetentionSnapshot) { s.Messages[0].SendTime = s.ServerTime.Add(time.Hour) },
	} {
		s := retentionSnapshot(1)
		mutate(&s)
		if _, err := PlanGroupRetention(s); err == nil {
			t.Fatal("unsafe snapshot accepted")
		}
	}
}
