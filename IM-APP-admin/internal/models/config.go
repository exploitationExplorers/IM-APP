package models

import "time"

// APP 与公共配置

type AppVersion struct {
	ID           string    `json:"id"`
	Platform     string    `json:"platform"`
	Version      string    `json:"version"`
	Description  string    `json:"description"`
	DownloadURL  string    `json:"downloadUrl"`
	ForceUpgrade *bool     `json:"forceUpgrade"` // *bool 区分"未传"与"false"，避免部分更新被零值覆盖
	Status       string    `json:"status"`       // draft|published
	CreatedAt    time.Time `json:"createdAt"`
}

type AppVersionStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=published draft"`
	Reason string `json:"reason" binding:"required"`
}

type LegalDocument struct {
	ID          string     `json:"id"`
	Type        string     `json:"type"` // user_agreement|privacy_policy
	Version     string     `json:"version"`
	Language    string     `json:"language"`
	Title       string     `json:"title"`
	ContentURL  string     `json:"contentUrl"`
	Status      string     `json:"status"` // draft|published
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
}

type LegalDocumentRequest struct {
	Type       string `json:"type" binding:"required"`
	Version    string `json:"version" binding:"required"`
	Language   string `json:"language"`
	Title      string `json:"title" binding:"required"`
	ContentURL string `json:"contentUrl" binding:"required"`
	Reason     string `json:"reason" binding:"required"`
}

type ReportReason struct {
	ID         string `json:"id"`
	TargetType string `json:"targetType"`
	Reason     string `json:"reason"`
	Language   string `json:"language"`
	SortOrder  int    `json:"sortOrder"`
	Status     string `json:"status"`
}

type SystemLimits struct {
	MaxFileSizeMB          int `json:"maxFileSizeMb"`
	MaxGroupMembers        int `json:"maxGroupMembers"`
	DefaultGroupMaxMembers int `json:"defaultGroupMaxMembers"`
	GroupMemberHardLimit   int `json:"groupMemberHardLimit,omitempty"`
	RecallWindowSec        int `json:"recallWindowSec"`
	MaxForwardTargets      int `json:"maxForwardTargets"`
	MaxNicknameLen         int `json:"maxNicknameLen"`
}

type SystemLimitsRequest struct {
	Limits *SystemLimits `json:"limits" binding:"required"`
	Reason string        `json:"reason" binding:"required"`
}

type GroupLimitImpact struct {
	ConfiguredAboveLimit int64 `json:"configuredAboveLimit"`
	CurrentlyOverLimit   int64 `json:"currentlyOverLimit"`
}

// FeatureFlags 功能开关（供 meta /features 返回，APP 端读取）
type FeatureFlags struct {
	MFA    bool `json:"mfa"`    // MFA 多因素认证
	Report bool `json:"report"` // 举报功能
}

type FeatureFlagsRequest struct {
	MFA    *bool  `json:"mfa"`
	Report *bool  `json:"report"`
	Reason string `json:"reason" binding:"required"`
}
