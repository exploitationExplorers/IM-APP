package models

import "time"

// 用户管理（复用 APP users 表 + user_restrictions）

type AppUser struct {
	ID            string    `json:"id"`
	PublicID      string    `json:"publicId"`
	PhoneMasked   string    `json:"phoneMasked"`
	CountryCode   string    `json:"countryCode"`
	Nickname      string    `json:"nickname"`
	Avatar        string    `json:"avatar"`
	Status        string    `json:"status"` // active|banned|cancelled
	LoginBanned   bool      `json:"loginBanned"`
	MessageBanned bool      `json:"messageBanned"`
	FriendCount   int64     `json:"friendCount"`
	GroupCount    int64     `json:"groupCount"`
	ReportCount   int64     `json:"reportCount"`
	CreatedAt     time.Time `json:"createdAt"`
}

type AppUserDetail struct {
	AppUser
	Bio      string   `json:"bio"`
	GroupIDs []string `json:"groupIds,omitempty"`
}

type PhoneRevealRequest struct {
	Reason   string `json:"reason" binding:"required"`
	TicketNo string `json:"ticketNo"`
}

type RestrictionRequest struct {
	Banned *bool      `json:"banned" binding:"required"`
	Until  *time.Time `json:"until,omitempty"`
	Reason string     `json:"reason" binding:"required"`
}

type BanRequest struct {
	Banned         *bool      `json:"banned" binding:"required"`
	Until          *time.Time `json:"until,omitempty"`
	Reason         string     `json:"reason" binding:"required"`
	TicketNo       string     `json:"ticketNo,omitempty"`
	IdempotencyKey string     `json:"idempotencyKey"`
}
