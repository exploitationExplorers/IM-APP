package models

type CreateFeedbackRequest struct {
	Contact      string   `json:"contact,omitempty"`
	Content      string   `json:"content"`
	ImageFileIDs []string `json:"imageFileIds,omitempty"`
}

type FeedbackResult struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
}
