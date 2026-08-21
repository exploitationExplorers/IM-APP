package models

import "time"

// 转发/群发与风控

type ForwardTask struct {
	ID                string     `json:"id"`
	UserID            string     `json:"userId"`
	SenderNickname    string     `json:"senderNickname,omitempty"`  // 发起人昵称（join users）
	ContentType       string     `json:"contentType,omitempty"`
	ContentSummary    string     `json:"contentSummary,omitempty"`
	SourceContentType int        `json:"sourceContentType"`         // OpenIM 数字消息类型（101文本/102图片/103语音/104视频…）
	Status            string     `json:"status"`
	TargetCount       int64      `json:"targetCount"`
	SuccessCount      int64      `json:"successCount"`
	FailedCount       int64      `json:"failedCount"`
	SkippedCount      int64      `json:"skippedCount"`
	RiskLevel         string     `json:"riskLevel,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	FinishedAt        *time.Time `json:"finishedAt,omitempty"`
	IsDuplicate       bool       `json:"isDuplicate"`               // 同 idempotency_key 存在更早任务时为重复提交
	FirstTargetName   string     `json:"firstTargetName,omitempty"` // 首个接收人昵称/群名（发给谁摘要）
	FirstTargetPeer   string     `json:"firstTargetPeer,omitempty"` // c2c | group
}

type ForwardTarget struct {
	ID             string     `json:"id"`
	UserID         string     `json:"userId"`
	PeerType       string     `json:"peerType"`
	Nickname       string     `json:"nickname,omitempty"`
	Status         string     `json:"status"`
	Attempts       int        `json:"attempts"`
	MessageID      string     `json:"messageId,omitempty"`
	FailCode       string     `json:"failCode,omitempty"`
	FailureMessage string     `json:"failureMessage,omitempty"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
}

type ForwardUserLimit struct {
	UserID        string `json:"userId"`
	DailyLimit    int    `json:"dailyLimit"`
	HourlyLimit   int    `json:"hourlyLimit"`
	SingleTargets int    `json:"singleTargets"`
	Enabled       bool   `json:"enabled"`
	Effective     bool   `json:"effective"` // 固定为 false；仅保留历史查询与审计兼容
}

type ForwardSettings struct {
	GlobalQPS             int       `json:"globalQps"`
	WorkerConcurrency     int       `json:"workerConcurrency"`
	ClaimBatchSize        int       `json:"claimBatchSize"`
	PerUserConcurrency    int       `json:"perUserConcurrency"`
	RetryBaseSeconds      int       `json:"retryBaseSeconds"`
	RetryMaxSeconds       int       `json:"retryMaxSeconds"`
	ProcessingLockSeconds int       `json:"processingLockSeconds"`
	QueuePaused           bool      `json:"queuePaused"`
	RetentionDays         int       `json:"retentionDays"`
	QueueAlertDepth       int64     `json:"queueAlertDepth"`
	Version               int64     `json:"version,omitempty"`
	UpdatedAt             time.Time `json:"updatedAt,omitempty"`
}

type ForwardQueueMetrics struct {
	Queued               int64   `json:"queued"`
	Retrying             int64   `json:"retrying"`
	Processing           int64   `json:"processing"`
	PermanentFailed      int64   `json:"permanentFailed"`
	OldestPendingSeconds int64   `json:"oldestPendingSeconds"`
	SendRatePerSecond    float64 `json:"sendRatePerSecond"`
}

type ForwardLimitRequest struct {
	DailyLimit    *int   `json:"dailyLimit,omitempty"`
	HourlyLimit   *int   `json:"hourlyLimit,omitempty"`
	SingleTargets *int   `json:"singleTargets,omitempty"`
	Enabled       *bool  `json:"enabled,omitempty"`
	Reason        string `json:"reason" binding:"required"`
}
