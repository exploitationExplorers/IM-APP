package models

import (
	"encoding/json"
	"time"
)

type IMPeer struct {
	BusinessUserID string `json:"businessUserId"`
	IMUserID       string `json:"imUserId"`
	Nickname       string `json:"nickname"`
	Avatar         string `json:"avatar"`
	CanChat        bool   `json:"canChat"`
	DenyReason     string `json:"denyReason"`
}

type IMGroupTarget struct {
	BusinessGroupID string     `json:"businessGroupId"`
	IMGroupID       string     `json:"imGroupId"`
	Name            string     `json:"name"`
	Avatar          string     `json:"avatar"`
	Role            string     `json:"role"`
	CanChat         bool       `json:"canChat"`
	DenyReason      string     `json:"denyReason"`
	MutedUntil      *time.Time `json:"mutedUntil"`
}

type IMGroupSyncState struct {
	ID                   string
	Name                 string
	Avatar               string
	OwnerID              string
	Announcement         string
	AllowMemberAddFriend bool
	Status               string
	AllMuted             bool
	Members              []IMGroupSyncMember
}

type IMGroupSyncMember struct {
	ID            string
	Nickname      string
	GroupNickname string
	Avatar        string
	Status        string
	Role          string
	MutedUntil    *time.Time
}

type IMSystemMessageRequest struct {
	IdempotencyKey     string          `json:"idempotencyKey"`
	ReceiverType       string          `json:"receiverType"`
	ReceiverBusinessID string          `json:"receiverBusinessId"`
	MessageType        string          `json:"messageType"`
	Text               string          `json:"text,omitempty"`
	Key                string          `json:"key,omitempty"`
	Data               json.RawMessage `json:"data,omitempty"`
	Guaranteed         bool            `json:"guaranteed"`
}

type IMSystemMessageResult struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Status         string `json:"status"`
	ServerMsgID    string `json:"serverMsgId,omitempty"`
	ClientMsgID    string `json:"clientMsgId,omitempty"`
}

type IMHealth struct {
	Configured          bool  `json:"configured"`
	APIReachable        bool  `json:"apiReachable"`
	AdminTokenAvailable bool  `json:"adminTokenAvailable"`
	OutboxPending       int64 `json:"outboxPending"`
	OutboxDead          int64 `json:"outboxDead"`
}

type IMReconcileResult struct {
	Users       int64 `json:"users"`
	Friendships int64 `json:"friendships"`
	Blocks      int64 `json:"blocks"`
	Groups      int64 `json:"groups"`
	Total       int64 `json:"total"`
}

type IMOutboxItem struct {
	ID            int64           `json:"id"`
	AggregateType string          `json:"aggregateType"`
	AggregateID   string          `json:"aggregateId"`
	EventType     string          `json:"eventType"`
	Payload       json.RawMessage `json:"payload"`
	Status        string          `json:"status"`
	AttemptCount  int             `json:"attemptCount"`
	LastError     string          `json:"lastError"`
	NextAttemptAt time.Time       `json:"nextAttemptAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}
