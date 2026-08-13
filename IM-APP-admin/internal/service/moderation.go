package service

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 敏感词与资料审核（清单 09） =====

func (s *OpsService) ListSensitiveWords(ctx context.Context, keyword string) ([]models.SensitiveWord, error) {
	return s.Repo.ListSensitiveWords(ctx, keyword)
}

func (s *OpsService) CreateSensitiveWord(ctx context.Context, w models.SensitiveWord) error {
	return s.Repo.CreateSensitiveWord(ctx, w)
}

func (s *OpsService) ImportSensitiveWords(ctx context.Context, req models.SensitiveWordImportRequest) (int, error) {
	return s.Repo.ImportSensitiveWords(ctx, req.Words, req.Category)
}

func (s *OpsService) UpdateSensitiveWord(ctx context.Context, id string, w models.SensitiveWord) error {
	return s.Repo.UpdateSensitiveWord(ctx, id, w)
}

func (s *OpsService) SetSensitiveWordStatus(ctx context.Context, id, status string) error {
	return s.Repo.SetSensitiveWordStatus(ctx, id, status)
}

func (s *OpsService) ListModerationHits(ctx context.Context, page, size int) ([]models.ModerationHit, int64, error) {
	return s.Repo.ListModerationHits(ctx, page, size)
}

func (s *OpsService) ListProfileModerations(ctx context.Context, status string, page, size int) ([]models.ProfileModeration, int64, error) {
	return s.Repo.ListProfileModerations(ctx, status, page, size)
}

func (s *OpsService) HandleProfileModeration(ctx context.Context, userID, field, toStatus, reason, handlerID string) error {
	return s.Repo.HandleProfileModeration(ctx, userID, field, toStatus, reason, handlerID)
}
