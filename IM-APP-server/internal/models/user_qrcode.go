package models

import "time"

// UserSummary 用户摘要（他人可见的最小信息）
type UserSummary struct {
	ID       string `json:"id"`
	PublicID string `json:"publicId"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

// UserQR 用户二维码记录（内部使用）
type UserQR struct {
	Token     string
	ExpiresAt time.Time
}

type ResolveQRCodeRequest struct {
	Token   string `json:"token"`
	Payload string `json:"payload"`
	QRCode  string `json:"qrcode"` // 兼容完整二维码 URL 或原始内容
}

type ChangePasswordRequest struct {
	Password    string `json:"password"`
	OldPassword string `json:"oldPassword,omitempty"`
}

type VerifyPasswordRequest struct {
	OldPassword string `json:"oldPassword"`
}

type UserQRCodeResolveResult struct {
	User     PublicProfile `json:"user"`
	Relation string        `json:"relation"`
}

type GroupQRCodeResult struct {
	GroupID   string `json:"groupId"`
	Payload   string `json:"payload"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

type GroupQRCodeResolveResult struct {
	Group    GroupInfo `json:"group"`
	Joined   bool      `json:"joined"`
	MemberID string    `json:"memberId,omitempty"`
}
type UserQRCodeResult struct {
	Payload   string      `json:"payload"` // 二维码内容，前端据此渲染二维码图片
	ExpiresAt string      `json:"expiresAt,omitempty"`
	User      UserSummary `json:"user"`
}
