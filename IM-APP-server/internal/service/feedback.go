package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

var ErrInvalidFeedbackRequest = errors.New("invalid feedback request")

const (
	maxFeedbackContentLen = 200
	maxFeedbackContactLen = 64
	maxFeedbackImages     = 1
)

type FeedbackService struct {
	Feedbacks *repository.FeedbackRepo
}

func (s *FeedbackService) Create(ctx context.Context, userID string, req models.CreateFeedbackRequest) (models.FeedbackResult, error) {
	content := strings.TrimSpace(req.Content)
	contact := strings.TrimSpace(req.Contact)
	if content == "" || utf8.RuneCountInString(content) > maxFeedbackContentLen {
		return models.FeedbackResult{}, ErrInvalidFeedbackRequest
	}
	if utf8.RuneCountInString(contact) > maxFeedbackContactLen {
		return models.FeedbackResult{}, ErrInvalidFeedbackRequest
	}
	if len(req.ImageFileIDs) > maxFeedbackImages {
		return models.FeedbackResult{}, ErrInvalidFeedbackRequest
	}

	imageFileID := ""
	if len(req.ImageFileIDs) == 1 {
		imageFileID = strings.TrimSpace(req.ImageFileIDs[0])
		if imageFileID == "" || uuid.Validate(imageFileID) != nil {
			return models.FeedbackResult{}, ErrInvalidFeedbackRequest
		}
	}

	return s.Feedbacks.Create(ctx, userID, contact, content, imageFileID)
}
