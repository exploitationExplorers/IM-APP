package media

import (
	"reflect"
	"testing"
	"time"
)

func TestRetentionCountProvenPrefix(t *testing.T) {
	quota := GroupRetentionCount
	full := retentionSnapshot(quota + 500)
	cutoff := full.ServerTime.Add(-GroupRetentionWindow)
	// Make the older tail both over-age and over-count so compact proof is valid.
	for i := range full.Messages {
		if i < 500 {
			full.Messages[i].SendTime = cutoff.Add(-time.Hour)
		}
	}
	expected, err := planDefault(full)
	if err != nil {
		t.Fatal(err)
	}
	want, err := RetentionMinSeq(expected)
	if err != nil {
		t.Fatal(err)
	}
	compact := full
	compact.Messages = full.Messages[len(full.Messages)-quota:]
	compact.OverCountThrough = compact.Messages[0].Seq - 1
	got, err := planDefault(compact)
	if err != nil {
		t.Fatal(err)
	}
	boundary, err := RetentionMinSeq(got)
	if err != nil || boundary != want || !reflect.DeepEqual(got.Kept, expected.Kept) {
		t.Fatal("tail proof differs from full actual-message count", boundary, want, err)
	}
	if got.OverCountThrough != compact.OverCountThrough {
		t.Fatal("prefix proof lost")
	}
	for _, mutate := range []func(*RetentionSnapshot){
		func(s *RetentionSnapshot) { s.Messages = s.Messages[1:] },
		func(s *RetentionSnapshot) {
			s.Messages = append([]RetentionMessage(nil), s.Messages...)
			s.Messages[0].Visibility = "hidden"
		},
		func(s *RetentionSnapshot) { s.OverCountThrough = s.Watermark },
		func(s *RetentionSnapshot) { s.OverCountThrough = -1 },
		func(s *RetentionSnapshot) { s.OverCountThrough = s.Messages[0].Seq },
	} {
		invalid := compact
		mutate(&invalid)
		if _, err := planDefault(invalid); err == nil {
			t.Fatal("invalid compact proof accepted")
		}
	}
}
