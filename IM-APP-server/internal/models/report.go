package models

type ReportReason struct {
	ID         string `json:"id"`
	TargetType string `json:"targetType"`
	Reason     string `json:"reason"`
	Language   string `json:"language"`
	SortOrder  int    `json:"sortOrder"`
}

type CreateReportRequest struct {
	TargetType      string   `json:"targetType"`
	TargetID        string   `json:"targetId"`
	ReasonID        string   `json:"reasonId"`
	Description     string   `json:"description,omitempty"`
	EvidenceFileIDs []string `json:"evidenceFileIds,omitempty"`
}

type ReportResult struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}
