package models

import "time"

// 消息发送记录与失败排查（读核心库 im_message_audit / im_message_send_failures）

// MessageRecord 一条成功发送的消息审计（im_message_audit）
type MessageRecord struct {
	CreatedAt        time.Time `json:"createdAt"`
	SendTime         int64     `json:"sendTime"` // OpenIM 发送时间戳（毫秒）
	ClientMsgID      string    `json:"clientMsgId"`
	SenderIMID       string    `json:"senderImId"`
	SenderNickname   string    `json:"senderNickname"`
	ReceiverIMID     string    `json:"receiverImId"`
	ReceiverNickname string    `json:"receiverNickname"`
	GroupIMID        string    `json:"groupImId"`
	GroupName        string    `json:"groupName"`
	ContentType      int       `json:"contentType"` // OpenIM 数字消息类型
	PeerType         string    `json:"peerType"`    // c2c | group
}

// MessageFailure 一条发送失败记录（im_message_send_failures）
type MessageFailure struct {
	ID             int64     `json:"id"`
	CreatedAt      time.Time `json:"createdAt"`
	OccurredAt     time.Time `json:"occurredAt"`
	ClientMsgID    string    `json:"clientMsgId"`
	SenderID       string    `json:"senderId"`
	SenderIMID     string    `json:"senderImId"`
	SenderNickname string    `json:"senderNickname"`
	PeerType       string    `json:"peerType"` // c2c | group
	TargetID       string    `json:"targetId"`
	TargetIMID     string    `json:"targetImId"`
	TargetName     string    `json:"targetName"`
	ContentType    int       `json:"contentType"`
	Source         string    `json:"source"` // client | before_hook
	Stage          string    `json:"stage"`  // create|upload|send|timeout|blocked
	FailCode       string    `json:"failCode"`
	FailMessage    string    `json:"failMessage"`
	Platform       string    `json:"platform"`
	AppVersion     string    `json:"appVersion"`
}

// MessageAuditFilter 成功消息列表筛选条件（零值表示不筛选）
type MessageAuditFilter struct {
	ContentType   int
	SenderKeyword string
	PeerType      string // c2c | group | ""
	From          time.Time
	To            time.Time
}

// MessageFailureFilter 失败消息列表筛选条件（零值表示不筛选）
type MessageFailureFilter struct {
	ContentType   int
	FailCode      string
	SenderKeyword string
	Source        string // client | before_hook | ""
	From          time.Time
	To            time.Time
}
