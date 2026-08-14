package models

import "time"

// 工作台

type DashboardOverview struct {
	Users          int64 `json:"users"`
	ActiveToday    int64 `json:"activeToday"`
	Groups         int64 `json:"groups"`
	MessagesToday  int64 `json:"messagesToday"`
	ForwardTasks   int64 `json:"forwardTasks"`
	SmsSentToday   int64 `json:"smsSentToday"`
	PendingReports int64 `json:"pendingReports"`
}

type DashboardTrend struct {
	Date          string `json:"date"`
	Registrations int64  `json:"registrations"`
	Active        int64  `json:"active"`
	Messages      int64  `json:"messages"`
	Reports       int64  `json:"reports"`
	Forwards      int64  `json:"forwards"`
}

type DashboardTodo struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // report|forward_risk|sms_failed|system_alert
	Title     string    `json:"title"`
	TargetID  string    `json:"targetId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}
