package models

import "time"

// 群组管理（复用 APP groups/group_members + group_status_logs）

type AppGroup struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Avatar      string    `json:"avatar"`
	OwnerID     string    `json:"ownerId"`
	OwnerName   string    `json:"ownerName,omitempty"`
	MemberCount int64     `json:"memberCount"`
	Status      string    `json:"status"` // normal|banned|dismissed|muted
	AllMuted    bool      `json:"allMuted"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AppGroupDetail struct {
	AppGroup
	JoinMode             string     `json:"joinMode"`
	AllowMemberAddFriend bool       `json:"allowMemberAddFriend"`
	Announcement         string     `json:"announcement"`
	MaxMembers           int        `json:"maxMembers"`              // 群成员上限（server 024）
	DissolvedAt          *time.Time `json:"dissolvedAt,omitempty"`   // 解散时间
	DissolvedByAdminId   string     `json:"dissolvedByAdminId,omitempty"` // 解散操作管理员ID
	DissolveReason       string     `json:"dissolveReason,omitempty"`     // 解散原因
}

type AppGroupMember struct {
	UserID     string     `json:"userId"`
	Nickname   string     `json:"nickname"`
	Role       string     `json:"role"`
	MutedUntil *time.Time `json:"mutedUntil,omitempty"`
	JoinedAt   time.Time  `json:"joinedAt"`
}

type MuteAllRequest struct {
	// *bool 允许显式传 false（解除全员禁言），validator 对指针 required 判空而非零值
	Muted  *bool  `json:"muted" binding:"required"`
	Reason string `json:"reason" binding:"required"`
}

type MemberAddFriendRequest struct {
	// *bool 允许显式传 false（关闭加好友），validator 对指针 required 判空而非零值
	Enabled *bool  `json:"enabled" binding:"required"`
	Reason  string `json:"reason" binding:"required"`
}

type DissolveRequest struct {
	Reason         string `json:"reason" binding:"required"`
	TicketNo       string `json:"ticketNo,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type AdminRecallRequest struct {
	Reason         string `json:"reason" binding:"required"`
	TicketNo       string `json:"ticketNo,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
	ClientMsgID    string `json:"clientMsgId"`    // OpenIM 消息 clientMsgID（server 反查定位撤回）
	ConversationID string `json:"conversationId"` // 或直接提供定位
	Seq            int64  `json:"seq"`
}

type RecallLog struct {
	ID           int64     `json:"id"`
	MessageID    string    `json:"messageId"`
	GroupID      string    `json:"groupId"`
	OperatorType string    `json:"operatorType"`
	OperatorName string    `json:"operatorName"`
	Reason       string    `json:"reason"`
	CreatedAt    time.Time `json:"createdAt"`
}

// GroupStatusLog 群状态变更记录（group_status_logs）
type GroupStatusLog struct {
	ID           int64     `json:"id"`
	GroupID      string    `json:"groupId"`
	FromStatus   string    `json:"fromStatus"`
	ToStatus     string    `json:"toStatus"`
	Reason       string    `json:"reason"`
	OperatorID   string    `json:"operatorId,omitempty"`
	OperatorName string    `json:"operatorName"`
	OperatorType string    `json:"operatorType"` // admin=管理员 / user=群主/用户（users/admin_users 双 JOIN 推导）
	CreatedAt    time.Time `json:"createdAt"`
}
