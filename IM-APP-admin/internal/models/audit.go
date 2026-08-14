package models

import "time"

// 审计与运行观测

type ErrorEvent struct {
	ID          int64     `json:"id"`
	Service     string    `json:"service"`
	Level       string    `json:"level"`
	Message     string    `json:"message"`
	Fingerprint string    `json:"fingerprint"`
	Count       int       `json:"count"`
	FirstAt     time.Time `json:"firstAt"`
	LastAt      time.Time `json:"lastAt"`
}

type ExportJob struct {
	ID         string     `json:"id"`
	Resource   string     `json:"resource"`
	Filters    string     `json:"filters"`
	Status     string     `json:"status"`
	FileURL    string     `json:"fileUrl,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
}
