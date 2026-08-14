package service

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== APP 与公共配置（清单 08） =====

func (s *OpsService) ListAppVersions(ctx context.Context) ([]models.AppVersion, error) {
	return s.Repo.ListAppVersions(ctx)
}

func (s *OpsService) CreateAppVersion(ctx context.Context, v models.AppVersion) error {
	return s.Repo.CreateAppVersion(ctx, v)
}

func (s *OpsService) UpdateAppVersion(ctx context.Context, id string, v models.AppVersion) error {
	return s.Repo.UpdateAppVersion(ctx, id, v)
}

func (s *OpsService) SetAppVersionStatus(ctx context.Context, id, status string) error {
	return s.Repo.SetAppVersionStatus(ctx, id, status)
}

func (s *OpsService) ListLegalDocuments(ctx context.Context) ([]models.LegalDocument, error) {
	return s.Repo.ListLegalDocuments(ctx)
}

func (s *OpsService) CreateLegalDocument(ctx context.Context, req models.LegalDocumentRequest) (string, error) {
	return s.Repo.CreateLegalDocument(ctx, req)
}

func (s *OpsService) PublishLegalDocument(ctx context.Context, id string) error {
	return s.Repo.PublishLegalDocument(ctx, id)
}

func (s *OpsService) ListReportReasons(ctx context.Context) ([]models.ReportReason, error) {
	return s.Repo.ListReportReasons(ctx)
}

func (s *OpsService) CreateReportReason(ctx context.Context, x models.ReportReason) error {
	return s.Repo.CreateReportReason(ctx, x)
}

func (s *OpsService) UpdateReportReason(ctx context.Context, id string, x models.ReportReason) error {
	return s.Repo.UpdateReportReason(ctx, id, x)
}

func (s *OpsService) SetReportReasonStatus(ctx context.Context, id, status string) error {
	return s.Repo.SetReportReasonStatus(ctx, id, status)
}

func (s *OpsService) GetSystemLimits(ctx context.Context) (*models.SystemLimits, error) {
	return s.Repo.GetSystemLimits(ctx)
}

func (s *OpsService) SaveSystemLimits(ctx context.Context, l *models.SystemLimits, operatorID string) error {
	return s.Repo.SaveSystemLimits(ctx, l, operatorID)
}

func (s *OpsService) PublishSystemLimits(ctx context.Context, operatorID string) error {
	return s.Repo.PublishSystemLimits(ctx, operatorID)
}
