package media

import (
	"reflect"
	"testing"
	"time"
)

func planDefault(s RetentionSnapshot) (RetentionPlan, error) {
	return PlanGroupRetention(s, DefaultRetentionPolicy())
}

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
	quota := GroupRetentionCount
	// All rows are within the window → union keeps everything, even past quota.
	for _, n := range []int{0, 1, quota - 1, quota, quota + 1, quota + 500} {
		s := retentionSnapshot(n)
		before := append([]RetentionMessage(nil), s.Messages...)
		p, err := planDefault(s)
		if err != nil || len(p.Kept) != n || len(p.Candidates) != 0 {
			t.Fatalf("n=%d: %+v %v", n, p, err)
		}
		if !reflect.DeepEqual(s.Messages, before) {
			t.Fatal("planner mutated source snapshot")
		}
	}
}

func TestRetentionCustomPolicyUnion(t *testing.T) {
	s := retentionSnapshot(10)
	cutoff := s.ServerTime.Add(-GroupRetentionWindow)
	for i := range s.Messages {
		s.Messages[i].SendTime = cutoff.Add(-time.Hour)
	}
	p, err := PlanGroupRetention(s, RetentionPolicy{MaxMessages: 3, Window: GroupRetentionWindow})
	if err != nil || len(p.Kept) != 3 || len(p.Candidates) != 7 || p.MaxMessages != 3 {
		t.Fatalf("custom quota over-age: %+v %v", p, err)
	}
	for _, c := range p.Candidates {
		if !c.OverAge || !c.OverCount {
			t.Fatalf("candidate must be both over-age and over-count: %+v", c)
		}
	}
}

func TestRetentionRollingWindowAndBoundary(t *testing.T) {
	s := retentionSnapshot(4)
	cutoff := s.ServerTime.Add(-GroupRetentionWindow)
	s.Messages[0].SendTime = cutoff.Add(-time.Nanosecond)
	s.Messages[1].SendTime = cutoff
	s.Messages[2].SendTime = cutoff.Add(time.Nanosecond)
	p, err := planDefault(s)
	// Under quota: over-age rows still kept (不足 3000 也保存).
	if err != nil || !reflect.DeepEqual(p.Kept, []int64{3, 6, 9, 12}) || len(p.Candidates) != 0 {
		t.Fatalf("under-quota over-age kept: %+v %v", p, err)
	}
	for i := range s.Messages {
		s.Messages[i].SendTime = cutoff.Add(-time.Second)
	}
	p, err = planDefault(s)
	if err != nil || len(p.Kept) != 4 || len(p.Candidates) != 0 {
		t.Fatalf("under quota must preserve old messages: %+v %v", p, err)
	}
}

func TestRetentionUnionDeletesOnlyWhenBothExceeded(t *testing.T) {
	now := time.Date(2026, 10, 18, 3, 0, 0, 0, time.FixedZone("CST", 8*3600))
	cutoff := now.Add(-GroupRetentionWindow)
	s := RetentionSnapshot{
		ConversationID: "sg_example", SessionType: "group", ServerTime: now, Complete: true, Watermark: 15,
		Messages: []RetentionMessage{
			{Seq: 3, SendTime: cutoff.Add(-time.Hour), Visibility: "visible"},  // over age, over count if quota=3
			{Seq: 6, SendTime: cutoff.Add(-time.Hour), Visibility: "visible"},
			{Seq: 9, SendTime: cutoff.Add(-time.Hour), Visibility: "visible"},
			{Seq: 12, SendTime: now.Add(-time.Hour), Visibility: "visible"}, // in window, keep even if rank high
			{Seq: 15, SendTime: now.Add(-time.Minute), Visibility: "visible"},
		},
	}
	p, err := PlanGroupRetention(s, RetentionPolicy{MaxMessages: 3, Window: GroupRetentionWindow})
	if err != nil {
		t.Fatal(err)
	}
	// Newest 3 by seq: 15,12,9 kept by count; 12,15 also in window; 6,3 over age+count → candidates.
	if !reflect.DeepEqual(p.Kept, []int64{9, 12, 15}) || len(p.Candidates) != 2 {
		t.Fatalf("union: %+v", p)
	}
	if !p.Candidates[0].OverAge || !p.Candidates[0].OverCount || p.Candidates[0].Seq != 3 {
		t.Fatalf("candidates: %+v", p.Candidates)
	}
}

func TestRetentionSnapshotIsolationAndNotices(t *testing.T) {
	quota := GroupRetentionCount
	s := retentionSnapshot(quota + 1)
	s.Messages[0].Visibility = "hidden"
	// A displayed system notice is explicitly classified visible, like text.
	s.Messages = append(s.Messages, RetentionMessage{Seq: s.Watermark + 1, SendTime: s.ServerTime.Add(time.Second), Visibility: "visible"})
	p, err := planDefault(s)
	// Within window: all visible kept; hidden + after-watermark excluded from kept.
	if err != nil || len(p.Kept) != quota || len(p.Candidates) != 0 || p.HiddenCount != 1 || p.AfterWatermarkCount != 1 {
		t.Fatalf("snapshot: %+v %v", p, err)
	}
	// Unsorted server cards yield the same plan.
	s.Messages[1], s.Messages[quota] = s.Messages[quota], s.Messages[1]
	q, err := planDefault(s)
	if err != nil || !reflect.DeepEqual(p, q) {
		t.Fatal("pagination order changes retention")
	}
	other := retentionSnapshot(1)
	other.ConversationID = "sg_other"
	q, err = planDefault(other)
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
		if _, err := planDefault(s); err == nil {
			t.Fatal("unsafe snapshot accepted")
		}
	}
}
