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

type IMAuditedMessage struct {
	ClientMsgID    string
	ConversationID string
	SenderIMID     string
	ContentType    int
	Seq            int64
	SendTime       int64
}

type RecallMessageRequest struct {
	PeerType    string `json:"peerType"`
	PeerID      string `json:"peerId"`
	ClientMsgID string `json:"clientMsgId"`
	Seq         int64  `json:"seq"`
	Reason      string `json:"reason"`
}

type MessageRecallResult struct {
	PeerType        string    `json:"peerType"`
	PeerID          string    `json:"peerId"`
	ClientMsgID     string    `json:"clientMsgId"`
	Seq             int64     `json:"seq"`
	Status          string    `json:"status"`
	AlreadyRecalled bool      `json:"alreadyRecalled"`
	RecalledAt      time.Time `json:"recalledAt"`
}

// ReportSendFailureRequest 客户端上报的一条发送失败记录（POST /im/message-send-failures）。
// 字段与设计文档 5.1 对齐；sender 身份不取此结构，由 JWT 解析。
type ReportSendFailureRequest struct {
	ClientMsgID string `json:"clientMsgId"`
	PeerType    string `json:"peerType"`    // c2c | group
	TargetID    string `json:"targetId"`    // 业务 UUID 或 OpenIM id
	ContentType int    `json:"contentType"` // OpenIM 数字类型
	Stage       string `json:"stage"`       // create|upload|send|timeout
	FailCode    string `json:"failCode"`
	FailMessage string `json:"failMessage"`
	Platform    string `json:"platform"`
	AppVersion  string `json:"appVersion"`
	OccurredAt  string `json:"occurredAt"` // RFC3339，可空
}
