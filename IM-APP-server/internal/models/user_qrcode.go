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

// UserQRCodeResult 个人二维码对外返回
type UserQRCodeResult struct {
	Payload   string      `json:"payload"` // 二维码内容，前端据此渲染二维码图片
	ExpiresAt string      `json:"expiresAt,omitempty"`
	User      UserSummary `json:"user"`
}
