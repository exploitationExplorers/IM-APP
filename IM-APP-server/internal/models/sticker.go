package models

import "time"

// Sticker 用户自定义表情
type Sticker struct {
	ID        string    `json:"id"`
	FileID    string    `json:"fileId,omitempty"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"createdAt"`
}

// CreateStickerRequest 新增表情：上传完成后传 fileId
type CreateStickerRequest struct {
	FileID string `json:"fileId"`
}

// DeleteStickersRequest 批量删除表情
type DeleteStickersRequest struct {
	StickerIDs []string `json:"stickerIds"`
}
