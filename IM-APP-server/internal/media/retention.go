package media

import (
	"errors"
	"sort"
	"strings"
	"time"
)

const (
	GroupRetentionWindow = 7 * 24 * time.Hour
	GroupRetentionCount  = 500
)

var ErrRetentionSnapshot = errors.New("retention requires a complete, classified group snapshot with trusted server time and committed watermark")

// RetentionSnapshot must come from an authoritative server adapter, never a
// client's local history. Complete includes all visible history below Watermark;
// sequence gaps are permitted. This structure grants no deletion capability.
type RetentionSnapshot struct {
	ConversationID string             `json:"conversationId"`
	SessionType    string             `json:"sessionType"`
	ServerTime     time.Time          `json:"serverTime"`
	Watermark      int64              `json:"committedWatermark"`
	Complete       bool               `json:"complete"`
	Messages       []RetentionMessage `json:"messages"`
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
	Mode                string               `json:"mode"`
	ConversationID      string               `json:"conversationId"`
	ServerTime          time.Time            `json:"serverTime"`
	Cutoff              time.Time            `json:"cutoff"`
	Watermark           int64                `json:"committedWatermark"`
	Kept                []int64              `json:"keptSeqs"`
	Candidates          []RetentionCandidate `json:"candidates"`
	HiddenCount         int                  `json:"hiddenCount"`
	AfterWatermarkCount int                  `json:"afterWatermarkCount"`
}

// PlanGroupRetention is deterministic and read-only. It counts actual visible
// messages rather than subtracting 500 from maxSeq. Neither caller input nor
// this output may be used as an authorization to delete objects or messages.
func PlanGroupRetention(snapshot RetentionSnapshot) (RetentionPlan, error) {
	if snapshot.SessionType != "group" || !strings.HasPrefix(snapshot.ConversationID, "sg_") ||
		len(snapshot.ConversationID) <= 3 || snapshot.ServerTime.IsZero() || snapshot.Watermark < 0 || !snapshot.Complete {
		return RetentionPlan{}, ErrRetentionSnapshot
	}
	plan := RetentionPlan{Mode: "preview_only", ConversationID: snapshot.ConversationID,
		ServerTime: snapshot.ServerTime.UTC(), Cutoff: snapshot.ServerTime.Add(-GroupRetentionWindow).UTC(),
		Watermark: snapshot.Watermark, Kept: []int64{}, Candidates: []RetentionCandidate{}}
	seen := make(map[int64]bool, len(snapshot.Messages))
	visible := make([]RetentionMessage, 0, len(snapshot.Messages))
	for _, message := range snapshot.Messages {
		if message.Seq <= 0 || seen[message.Seq] {
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
	sort.Slice(visible, func(i, j int) bool { return visible[i].Seq > visible[j].Seq })
	for rank, message := range visible {
		candidate := RetentionCandidate{Seq: message.Seq, OverAge: message.SendTime.Before(plan.Cutoff), OverCount: rank >= GroupRetentionCount}
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
