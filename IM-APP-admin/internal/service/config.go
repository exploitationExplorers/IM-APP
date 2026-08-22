package service

import (
	"context"
	"errors"

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
	l, err := s.Repo.GetSystemLimits(ctx)
	if l != nil {
		l.GroupMemberHardLimit = s.groupMemberHardLimit()
	}
	return l, err
}

func (s *OpsService) SaveSystemLimits(ctx context.Context, l *models.SystemLimits, operatorID string) error {
	if l == nil || l.MaxGroupMembers < 3 || l.MaxGroupMembers > s.groupMemberHardLimit() ||
		l.DefaultGroupMaxMembers < 3 || l.DefaultGroupMaxMembers > l.MaxGroupMembers {
		return errors.New("群人数配置必须满足 3 ≤ 新群默认上限 ≤ 平台上限 ≤ 技术安全上限")
	}
	l.GroupMemberHardLimit = 0
	return s.Repo.SaveSystemLimits(ctx, l, operatorID)
}

func (s *OpsService) GroupLimitImpact(ctx context.Context, limit int) (models.GroupLimitImpact, error) {
	if limit < 3 || limit > s.groupMemberHardLimit() {
		return models.GroupLimitImpact{}, errors.New("群人数上限不合法")
	}
	return s.Repo.GroupLimitImpact(ctx, limit)
}

func (s *OpsService) groupMemberHardLimit() int {
	if s.GroupMemberHardLimit < 3 {
		return 4000
	}
	return s.GroupMemberHardLimit
}

func (s *OpsService) GetFeatureFlags(ctx context.Context) (*models.FeatureFlags, error) {
	return s.Repo.GetFeatureFlags(ctx)
}

func (s *OpsService) SaveFeatureFlags(ctx context.Context, flags *models.FeatureFlags, operatorID string) error {
	return s.Repo.SaveFeatureFlags(ctx, flags, operatorID)
}

func (s *OpsService) PublishSystemLimits(ctx context.Context, operatorID string) error {
	l, err := s.Repo.GetSystemLimits(ctx)
	if err != nil {
		return err
	}
	if l.MaxGroupMembers < 3 || l.MaxGroupMembers > s.groupMemberHardLimit() ||
		l.DefaultGroupMaxMembers < 3 || l.DefaultGroupMaxMembers > l.MaxGroupMembers {
		return errors.New("草稿群人数配置不合法，请先按当前技术安全上限重新保存草稿")
	}
	return s.Repo.PublishSystemLimits(ctx, operatorID)
}
