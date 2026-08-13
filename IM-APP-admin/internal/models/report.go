package models

import "time"

// 举报与内容处置

type Report struct {
	ID          string    `json:"id"`
	ReportNo    string    `json:"reportNo"`
	ReporterID  string    `json:"reporterId,omitempty"`
	TargetType  string    `json:"targetType"` // user|group|message
	TargetID    string    `json:"targetId"`
	ReasonText  string    `json:"reasonText"`
	Description string    `json:"description"`
	Status      string    `json:"status"` // pending|processing|resolved|rejected|reopened
	AssigneeID  string    `json:"assigneeId,omitempty"`
	Conclusion  string    `json:"conclusion,omitempty"`
	ActionTaken string    `json:"actionTaken,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type ReportFile struct {
	ID          string `json:"id"`
	FileURL     string `json:"fileUrl"`
	ContentType string `json:"contentType"`
	MessageID   string `json:"messageId"`
}

type ReportDetail struct {
	Report
	Files []ReportFile `json:"files,omitempty"`
	Notes []ReportNote `json:"notes,omitempty"`
}

type ReportNote struct {
	ID        int64     `json:"id"`
	AdminID   string    `json:"adminId,omitempty"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

type ReportAction struct {
	ID           int64     `json:"id"`
	AdminID      string    `json:"adminId,omitempty"`
	Action       string    `json:"action"`
	BeforeStatus string    `json:"beforeStatus"`
	AfterStatus  string    `json:"afterStatus"`
	Detail       string    `json:"detail"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ReportAssignRequest struct {
	AssigneeID string `json:"assigneeId" binding:"required"`
	Reason     string `json:"reason" binding:"required"`
}

type ReportNoteRequest struct {
	Content string `json:"content" binding:"required"`
}

type ReportResolveRequest struct {
	Conclusion     string   `json:"conclusion"`
	DisposeActions []string `json:"disposeActions"` // warn|restrict_login|restrict_message|ban|mute_all|recall|dissolve
	Reason         string   `json:"reason" binding:"required"`
	TicketNo       string   `json:"ticketNo,omitempty"`
	IdempotencyKey string   `json:"idempotencyKey"`
}
