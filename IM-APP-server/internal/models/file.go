package models

// 文件模块 DTO（按 GOAL-APP 清单）

type FileObject struct {
	ID           string `json:"id"`
	Purpose      string `json:"purpose"` // avatar|image|voice|file|sticker
	FileName     string `json:"fileName"`
	ContentType  string `json:"contentType"`
	Size         int64  `json:"size"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	DurationMs   int64  `json:"durationMs,omitempty"`
	Status       string `json:"status"` // pending|ready|rejected
}

type CreateUploadRequest struct {
	Purpose     string `json:"purpose"` // avatar|image|voice|file|sticker
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256,omitempty"`
}

type UploadInitResult struct {
	File      FileObject        `json:"file"`
	UploadURL string            `json:"uploadUrl"`
	FormURL   string            `json:"formUrl,omitempty"`
	FormData  map[string]string `json:"formData,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	ExpiresIn int               `json:"expiresIn"`
}

type CompleteUploadRequest struct {
	FileID string `json:"fileId"`
	ETag   string `json:"etag,omitempty"`
}
