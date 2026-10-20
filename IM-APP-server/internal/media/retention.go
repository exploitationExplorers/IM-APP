package media

import (
	"errors"
	"sort"
	"strings"
	"time"
)

const (
	GroupRetentionWindow = 7 * 24 * time.Hour
	GroupRetentionCount  = 1500
	// Hard clamps for admin / per-group overrides.
	GroupRetentionCountMin  = 1
	GroupRetentionCountMax  = 20000
	GroupRetentionHoursMin  = 1
	GroupRetentionHoursMax  = 90 * 24
)

var ErrRetentionSnapshot = errors.New("retention requires a complete, classified group snapshot with trusted server time and committed watermark")

// RetentionPolicy is the keep window + visible-message quota for one plan.
type RetentionPolicy struct {
	MaxMessages int           `json:"maxMessages"`
	Window      time.Duration `json:"window"`
}

func DefaultRetentionPolicy() RetentionPolicy {
	return RetentionPolicy{MaxMessages: GroupRetentionCount, Window: GroupRetentionWindow}
}

// NormalizeRetentionPolicy fills zeros and clamps to safe bounds.
func NormalizeRetentionPolicy(policy RetentionPolicy) RetentionPolicy {
	out := policy
	if out.MaxMessages <= 0 {
		out.MaxMessages = GroupRetentionCount
	}
	if out.MaxMessages < GroupRetentionCountMin {
		out.MaxMessages = GroupRetentionCountMin
	}
	if out.MaxMessages > GroupRetentionCountMax {
		out.MaxMessages = GroupRetentionCountMax
	}
	if out.Window <= 0 {
		out.Window = GroupRetentionWindow
	}
	minWin := time.Duration(GroupRetentionHoursMin) * time.Hour
	maxWin := time.Duration(GroupRetentionHoursMax) * time.Hour
	if out.Window < minWin {
		out.Window = minWin
	}
	if out.Window > maxWin {
		out.Window = maxWin
	}
	return out
}

// RetentionSnapshot must come from an authoritative server adapter, never a
// client's local history. Complete includes all history still requiring
// classification. An optional count-proven prefix can be summarized only when
// at least MaxMessages actual visible messages after it are included. Sequence
// arithmetic or a reserved maxSeq is never such proof. This grants no object
// deletion ability.
type RetentionSnapshot struct {
	// Adapter-issued receipt binds an apply request to the exact persisted snapshot.
	SnapshotID       string             `json:"snapshotId,omitempty"`
	ConversationID   string             `json:"conversationId"`
	SessionType      string             `json:"sessionType"`
	ServerTime       time.Time          `json:"serverTime"`
	Watermark        int64              `json:"committedWatermark"`
	OverCountThrough int64              `json:"overCountThrough,omitempty"`
	Complete         bool               `json:"complete"`
	Messages         []RetentionMessage `json:"messages"`
}

type RetentionMessage struct {
	Seq      int64     `json:"seq"`
	SendTime time.Time `json:"sendTime"`
	// visible includes displayed group notices. Hidden tombstones/control
	// messages do not consume the quota. Unknown classifications fail closed.
	Visibility string `json:"visibility"`
}

type RetentionCandidate struct {
	Seq       int64 `json:"seq"`
	OverAge   bool  `json:"overAge"`
	OverCount bool  `json:"overCount"`
}

type RetentionPlan struct {
	SnapshotID     string    `json:"snapshotId,omitempty"`
	Mode           string    `json:"mode"`
	ConversationID string    `json:"conversationId"`
	ServerTime     time.Time `json:"serverTime"`
	Cutoff         time.Time `json:"cutoff"`
	Watermark      int64     `json:"committedWatermark"`
	// MaxMessages is the quota used when this plan was computed (for MinSeq checks).
	MaxMessages int `json:"maxMessages,omitempty"`
	// Every older sequence is over quota regardless of missing/pending slots.
	// Candidates contains only explicitly scanned rows, not this summarized prefix.
	OverCountThrough    int64                `json:"overCountThrough,omitempty"`
	Kept                []int64              `json:"keptSeqs"`
	Candidates          []RetentionCandidate `json:"candidates"`
	HiddenCount         int                  `json:"hiddenCount"`
	AfterWatermarkCount int                  `json:"afterWatermarkCount"`
}

// PlanGroupRetention is deterministic and read-only. It counts actual visible
// messages rather than subtracting MaxMessages from maxSeq. Neither caller input
// nor this output may be used as an authorization to delete objects or messages.
func PlanGroupRetention(snapshot RetentionSnapshot, policy RetentionPolicy) (RetentionPlan, error) {
	policy = NormalizeRetentionPolicy(policy)
	if snapshot.SessionType != "group" || !strings.HasPrefix(snapshot.ConversationID, "sg_") ||
		len(snapshot.ConversationID) <= 3 || snapshot.ServerTime.IsZero() || snapshot.Watermark < 0 || snapshot.Watermark >= 1<<53 ||
		snapshot.OverCountThrough < 0 || (snapshot.OverCountThrough > 0 && snapshot.OverCountThrough >= snapshot.Watermark) || !snapshot.Complete {
		return RetentionPlan{}, ErrRetentionSnapshot
	}
	plan := RetentionPlan{SnapshotID: snapshot.SnapshotID, Mode: "preview_only", ConversationID: snapshot.ConversationID,
		ServerTime: snapshot.ServerTime.UTC(), Cutoff: snapshot.ServerTime.Add(-policy.Window).UTC(),
		Watermark: snapshot.Watermark, MaxMessages: policy.MaxMessages, OverCountThrough: snapshot.OverCountThrough,
		Kept: []int64{}, Candidates: []RetentionCandidate{}}
	seen := make(map[int64]bool, len(snapshot.Messages))
	visible := make([]RetentionMessage, 0, len(snapshot.Messages))
	for _, message := range snapshot.Messages {
		if message.Seq <= snapshot.OverCountThrough || message.Seq >= 1<<53 || seen[message.Seq] {
			return RetentionPlan{}, ErrRetentionSnapshot
		}
		seen[message.Seq] = true
		if message.Seq > snapshot.Watermark {
			plan.AfterWatermarkCount++
			continue // A concurrent send is outside this fixed snapshot.
		}
		switch message.Visibility {
		case "hidden":
			plan.HiddenCount++
		case "visible":
			if message.SendTime.IsZero() || message.SendTime.After(snapshot.ServerTime) {
				return RetentionPlan{}, ErrRetentionSnapshot
			}
			visible = append(visible, message)
		default:
			return RetentionPlan{}, ErrRetentionSnapshot
		}
	}
	if snapshot.OverCountThrough > 0 && len(visible) < policy.MaxMessages {
		return RetentionPlan{}, ErrRetentionSnapshot
	}
	sort.Slice(visible, func(i, j int) bool { return visible[i].Seq > visible[j].Seq })
	for rank, message := range visible {
		candidate := RetentionCandidate{Seq: message.Seq, OverAge: message.SendTime.Before(plan.Cutoff), OverCount: rank >= policy.MaxMessages}
		if candidate.OverAge || candidate.OverCount {
			plan.Candidates = append(plan.Candidates, candidate)
		} else {
			plan.Kept = append(plan.Kept, message.Seq)
		}
	}
	// Stable ascending order makes independent previews easy to compare.
	sort.Slice(plan.Kept, func(i, j int) bool { return plan.Kept[i] < plan.Kept[j] })
	sort.Slice(plan.Candidates, func(i, j int) bool { return plan.Candidates[i].Seq < plan.Candidates[j].Seq })
	return plan, nil
}
