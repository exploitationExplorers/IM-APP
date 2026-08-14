package models

import "time"

// 国家与短信运营

type Country struct {
	Code      string `json:"code"`
	DialCode  string `json:"dialCode"`
	CNName    string `json:"cnName"`
	ENName    string `json:"enName"`
	PhoneRule string `json:"phoneRule,omitempty"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
}

type CountryStatusRequest struct {
	Enabled *bool  `json:"enabled" binding:"required"`
	Reason  string `json:"reason" binding:"required"`
}

type SmsLog struct {
	ID          int64     `json:"id"`
	PhoneMasked string    `json:"phoneMasked"`
	CountryCode string    `json:"countryCode"`
	Scene       string    `json:"scene"`
	Status      string    `json:"status"`
	ErrorCode   string    `json:"errorCode,omitempty"`
	Provider    string    `json:"provider"`
	CreatedAt   time.Time `json:"createdAt"`
}

type SmsStatPoint struct {
	Date    string `json:"date"`
	Total   int64  `json:"total"`
	Success int64  `json:"success"`
	Failed  int64  `json:"failed"`
}

type SmsStatistics struct {
	Total   int64          `json:"total"`
	Success int64          `json:"success"`
	Failed  int64          `json:"failed"`
	Rate    float64        `json:"deliveredRate"`
	ByDate  []SmsStatPoint `json:"byDate,omitempty"`
}

type ProviderHealth struct {
	Provider  string `json:"provider"`
	Healthy   bool   `json:"healthy"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
}
