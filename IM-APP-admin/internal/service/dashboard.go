package service

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 运行错误 / 导出（清单 10） =====

func (s *OpsService) ListErrorEvents(ctx context.Context, page, size int) ([]models.ErrorEvent, int64, error) {
	return s.Repo.ListErrorEvents(ctx, page, size)
}

func (s *OpsService) GetErrorEvent(ctx context.Context, id int64) (*models.ErrorEvent, error) {
	return s.Repo.GetErrorEvent(ctx, id)
}

func (s *OpsService) CreateExportJob(ctx context.Context, resource, filters, creatorID string) (string, error) {
	return s.Repo.CreateExportJob(ctx, resource, filters, creatorID)
}

func (s *OpsService) ListExportJobs(ctx context.Context, creatorID string, page, size int) ([]models.ExportJob, int64, error) {
	return s.Repo.ListExportJobs(ctx, creatorID, page, size)
}

// ===== 工作台（清单 02） =====

func (s *OpsService) DashboardOverview(ctx context.Context) (*models.DashboardOverview, error) {
	return s.Repo.DashboardOverview(ctx)
}

func (s *OpsService) DashboardTrends(ctx context.Context, days int) ([]models.DashboardTrend, error) {
	return s.Repo.DashboardTrends(ctx, days)
}

func (s *OpsService) DashboardTodos(ctx context.Context) ([]models.DashboardTodo, error) {
	return s.Repo.DashboardTodos(ctx)
}
