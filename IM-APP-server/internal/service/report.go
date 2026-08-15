package service

import (
	"context"
	"errors"
	"strings"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

var (
	ErrInvalidReportRequest = errors.New("invalid report request")
	ErrCannotReportSelf     = errors.New("cannot report self")
)

const maxReportEvidenceFiles = 9

type ReportService struct {
	Reports *repository.ReportRepo
}

func (s *ReportService) ListReasons(ctx context.Context, targetType, language string) ([]models.ReportReason, error) {
	targetType = strings.TrimSpace(targetType)
	language = strings.TrimSpace(language)
	if language == "" {
		language = "zh"
	}
	if targetType != "user" || len(language) > 8 {
		return nil, ErrInvalidReportRequest
	}
	return s.Reports.ListReasons(ctx, targetType, language)
}

func (s *ReportService) Create(ctx context.Context, reporterID string, req models.CreateReportRequest) (models.ReportResult, error) {
	req.TargetType = strings.TrimSpace(req.TargetType)
	req.TargetID = strings.TrimSpace(req.TargetID)
	req.ReasonID = strings.TrimSpace(req.ReasonID)
	req.Description = strings.TrimSpace(req.Description)

	if req.TargetType != "user" || uuid.Validate(req.TargetID) != nil || uuid.Validate(req.ReasonID) != nil {
		return models.ReportResult{}, ErrInvalidReportRequest
	}
	if reporterID == req.TargetID {
		return models.ReportResult{}, ErrCannotReportSelf
	}
	if len([]rune(req.Description)) > 1000 || len(req.EvidenceFileIDs) > maxReportEvidenceFiles {
		return models.ReportResult{}, ErrInvalidReportRequest
	}
	for i := range req.EvidenceFileIDs {
		req.EvidenceFileIDs[i] = strings.TrimSpace(req.EvidenceFileIDs[i])
		if uuid.Validate(req.EvidenceFileIDs[i]) != nil {
			return models.ReportResult{}, ErrInvalidReportRequest
		}
	}
	return s.Reports.CreateUserReport(ctx, reporterID, req)
}
