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
	Status      string    `json:"status"` // normal|banned|dissolved|muted
	AllMuted    bool      `json:"allMuted"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AppGroupDetail struct {
	AppGroup
	JoinMode             string `json:"joinMode"`
	AllowMemberAddFriend bool   `json:"allowMemberAddFriend"`
	Announcement         string `json:"announcement"`
}

type AppGroupMember struct {
	UserID     string     `json:"userId"`
	Nickname   string     `json:"nickname"`
	Role       string     `json:"role"`
	MutedUntil *time.Time `json:"mutedUntil,omitempty"`
	JoinedAt   time.Time  `json:"joinedAt"`
}

type MuteAllRequest struct {
	Muted  bool   `json:"muted" binding:"required"`
	Reason string `json:"reason" binding:"required"`
}

type MemberAddFriendRequest struct {
	Enabled bool   `json:"enabled" binding:"required"`
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
