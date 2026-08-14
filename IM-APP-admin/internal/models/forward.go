package models

import "time"

// 转发/群发与风控

type ForwardTask struct {
	ID             string     `json:"id"`
	UserID         string     `json:"userId"`
	ContentType    string     `json:"contentType,omitempty"`
	ContentSummary string     `json:"contentSummary,omitempty"`
	Status         string     `json:"status"`
	TargetCount    int64      `json:"targetCount"`
	SuccessCount   int64      `json:"successCount"`
	FailedCount    int64      `json:"failedCount"`
	SkippedCount   int64      `json:"skippedCount"`
	RiskLevel      string     `json:"riskLevel,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
}

type ForwardTarget struct {
	ID         string     `json:"id"`
	UserID     string     `json:"userId"`
	Nickname   string     `json:"nickname,omitempty"`
	Status     string     `json:"status"`
	Attempts   int        `json:"attempts"`
	MessageID  string     `json:"messageId,omitempty"`
	FailCode   string     `json:"failCode,omitempty"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}

type ForwardUserLimit struct {
	UserID        string `json:"userId"`
	DailyLimit    int    `json:"dailyLimit"`
	HourlyLimit   int    `json:"hourlyLimit"`
	SingleTargets int    `json:"singleTargets"`
	Enabled       bool   `json:"enabled"`
}

type ForwardSettings struct {
	DefaultDailyLimit    int `json:"defaultDailyLimit"`
	DefaultHourlyLimit   int `json:"defaultHourlyLimit"`
	DefaultSingleTargets int `json:"defaultSingleTargets"`
	MaxSingleTargets     int `json:"maxSingleTargets"`
}

type ForwardLimitRequest struct {
	DailyLimit    *int   `json:"dailyLimit,omitempty"`
	HourlyLimit   *int   `json:"hourlyLimit,omitempty"`
	SingleTargets *int   `json:"singleTargets,omitempty"`
	Enabled       *bool  `json:"enabled,omitempty"`
	Reason        string `json:"reason" binding:"required"`
}
