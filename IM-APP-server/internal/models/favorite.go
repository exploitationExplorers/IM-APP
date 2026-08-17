package models

import "time"

// Favorite 收藏记录（收藏消息：文字/图片/视频/文件/语音）
type Favorite struct {
	ID             string    `json:"id"`
	MessageID      string    `json:"messageId"`
	Type           string    `json:"type"` // text|emoji|image|video|file|voice
	Content        string    `json:"content"`
	SenderID       string    `json:"senderId"`
	ConversationID string    `json:"conversationId"`
	CreatedAt      time.Time `json:"createdAt"`
}

// CreateFavoriteRequest 收藏请求。OpenIM 主路径传消息快照，不再查业务库 messages。
type CreateFavoriteRequest struct {
	MessageID      string `json:"messageId"`
	Type           string `json:"type"`
	Content        string `json:"content"`
	SenderID       string `json:"senderId"`
	ConversationID string `json:"conversationId"`
}
