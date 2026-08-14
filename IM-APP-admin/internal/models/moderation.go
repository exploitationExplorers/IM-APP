package models

import "time"

// 敏感词与资料审核

type SensitiveWord struct {
	ID        string    `json:"id"`
	Word      string    `json:"word"`
	Category  string    `json:"category"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type SensitiveWordImportRequest struct {
	Words    []string `json:"words" binding:"required"`
	Category string   `json:"category"`
	Reason   string   `json:"reason" binding:"required"`
}

type ModerationHit struct {
	ID          int64     `json:"id"`
	UserID      string    `json:"userId,omitempty"`
	Field       string    `json:"field"`
	Content     string    `json:"content"`
	MatchedWord string    `json:"matchedWord"`
	Category    string    `json:"category"`
	Disposition string    `json:"disposition"`
	CreatedAt   time.Time `json:"createdAt"`
}

type ProfileModeration struct {
	ID        int64      `json:"id"`
	UserID    string     `json:"userId"`
	Field     string     `json:"field"`
	OldValue  string     `json:"oldValue"`
	NewValue  string     `json:"newValue"`
	Status    string     `json:"status"`
	Reason    string     `json:"reason,omitempty"`
	HandledAt *time.Time `json:"handledAt,omitempty"`
}
