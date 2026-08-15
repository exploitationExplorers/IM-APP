package models

import (
	"encoding/json"
	"time"
)

const (
	ForwardTaskDraft              = "draft"
	ForwardTaskExpanding          = "expanding"
	ForwardTaskPending            = "pending"
	ForwardTaskProcessing         = "processing"
	ForwardTaskCompleted          = "completed"
	ForwardTaskPartiallyCompleted = "partially_completed"
	ForwardTaskFailed             = "failed"
	ForwardTaskPaused             = "paused"
	ForwardTaskCancelled          = "cancelled"

	ForwardTargetPending    = "pending"
	ForwardTargetProcessing = "processing"
	ForwardTargetRetrying   = "retrying"
	ForwardTargetSuccess    = "success"
	ForwardTargetFailed     = "failed"
	ForwardTargetSkipped    = "skipped"
	ForwardTargetCancelled  = "cancelled"
)

type ForwardSelector struct {
	Mode    string   `json:"mode"`
	TagIDs  []string `json:"tagIds,omitempty"`
	Keyword string   `json:"keyword,omitempty"`
}

// ForwardMessageSnapshot 是任务提交时冻结的 OpenIM 消息内容。
// Content 保持 OpenIM /msg/send_msg 所需的结构，不保存本地文件路径。
type ForwardMessageSnapshot struct {
	ContentType int             `json:"contentType"`
	Content     json.RawMessage `json:"content"`
}

type ForwardTask struct {
	ID                   string                 `json:"id"`
	UserID               string                 `json:"-"`
	SourceConversationID string                 `json:"sourceConversationId"`
	SourceClientMsgID    string                 `json:"sourceClientMsgId"`
	SourceServerMsgID    string                 `json:"sourceServerMsgId,omitempty"`
	SourceMessageID      string                 `json:"sourceMessageId,omitempty"`
	SourceSnapshot       ForwardMessageSnapshot `json:"sourceSnapshot"`
	Selector             ForwardSelector        `json:"selector"`
	IdempotencyKey       string                 `json:"idempotencyKey"`
	Status               string                 `json:"status"`
	TargetCount          int64                  `json:"targetCount"`
	DoneCount            int64                  `json:"doneCount"`
	SuccessCount         int64                  `json:"successCount"`
	FailedCount          int64                  `json:"failedCount"`
	SkippedCount         int64                  `json:"skippedCount"`
	CancelledCount       int64                  `json:"cancelledCount"`
	PendingCount         int64                  `json:"pendingCount"`
	ProcessingCount      int64                  `json:"processingCount"`
	StartedAt            *time.Time             `json:"startedAt,omitempty"`
	FinishedAt           *time.Time             `json:"finishedAt,omitempty"`
	CreatedAt            time.Time              `json:"createdAt"`
	UpdatedAt            time.Time              `json:"updatedAt"`
}

type ForwardTarget struct {
	ID              string     `json:"id"`
	TaskID          string     `json:"taskId"`
	TargetUserID    string     `json:"targetUserId"`
	Status          string     `json:"status"`
	Attempts        int        `json:"attempts"`
	ConversationID  string     `json:"conversationId,omitempty"`
	SentClientMsgID string     `json:"sentClientMsgId,omitempty"`
	SentServerMsgID string     `json:"sentServerMsgId,omitempty"`
	FailureCode     string     `json:"failureCode,omitempty"`
	FailureMessage  string     `json:"failureMessage,omitempty"`
	NextRetryAt     time.Time  `json:"nextRetryAt"`
	LockedBy        string     `json:"-"`
	FinishedAt      *time.Time `json:"finishedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type ForwardTargetPage struct {
	Items      []ForwardTarget `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
	HasMore    bool            `json:"hasMore"`
}

type ForwardTaskPage struct {
	Items      []ForwardTask `json:"items"`
	NextCursor string        `json:"nextCursor,omitempty"`
	HasMore    bool          `json:"hasMore"`
}
