package service

import (
	"context"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"
)

// OpsService 转发/国家短信/配置/敏感词/审计/工作台
type OpsService struct {
	Repo *repository.OpsRepo
}

// ===== 转发/群发与风控（清单 06） =====

func (s *OpsService) ListForwardTasks(ctx context.Context, status string, page, size int) ([]models.ForwardTask, int64, error) {
	return s.Repo.ListForwardTasks(ctx, status, size, (page-1)*size)
}

func (s *OpsService) GetForwardTask(ctx context.Context, id string) (*models.ForwardTask, error) {
	return s.Repo.GetForwardTask(ctx, id)
}

func (s *OpsService) ListForwardTargets(ctx context.Context, id, status string, page, size int) ([]models.ForwardTarget, int64, error) {
	return s.Repo.ListForwardTargets(ctx, id, status, size, (page-1)*size)
}

func (s *OpsService) ForwardFailures(ctx context.Context, id string) ([]map[string]any, error) {
	return s.Repo.ForwardFailures(ctx, id)
}

func (s *OpsService) CancelForwardTask(ctx context.Context, id, operatorID, reason string) error {
	return s.Repo.CancelForwardTask(ctx, id, operatorID, reason)
}

func (s *OpsService) RetryFailedTargets(ctx context.Context, id, operatorID string) (int64, error) {
	return s.Repo.RetryFailedTargets(ctx, id, operatorID)
}

func (s *OpsService) GetForwardUserLimit(ctx context.Context, userID string) (*models.ForwardUserLimit, error) {
	return s.Repo.GetForwardUserLimit(ctx, userID)
}

func (s *OpsService) SetForwardUserLimit(ctx context.Context, userID string, req models.ForwardLimitRequest, operatorID string) error {
	return s.Repo.SetForwardUserLimit(ctx, userID, req, operatorID)
}

func (s *OpsService) GetForwardSettings(ctx context.Context) (*models.ForwardSettings, error) {
	return s.Repo.GetForwardSettings(ctx)
}

func (s *OpsService) SetForwardSettings(ctx context.Context, settings *models.ForwardSettings, operatorID string) error {
	return s.Repo.SetForwardSettings(ctx, settings, operatorID)
}
