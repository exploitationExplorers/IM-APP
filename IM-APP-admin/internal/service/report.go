package service

import (
	"context"
	"strings"

	"im-app-admin/internal/models"
)

// ===== 举报 =====

func (s *DataService) ListReports(ctx context.Context, status, targetType, keyword string, page, size int) ([]models.Report, int64, error) {
	return s.Repo.ListReports(ctx, status, targetType, keyword, size, (page-1)*size)
}

func (s *DataService) GetReport(ctx context.Context, id string) (*models.ReportDetail, error) {
	return s.Repo.GetReport(ctx, id)
}

func (s *DataService) AssignReport(ctx context.Context, id string, req models.ReportAssignRequest, operatorID string) error {
	return s.Repo.AssignReport(ctx, id, req.AssigneeID, operatorID, req.Reason)
}

func (s *DataService) StartReport(ctx context.Context, id, operatorID string) error {
	return s.Repo.StartReport(ctx, id, operatorID)
}

func (s *DataService) AddReportNote(ctx context.Context, id string, req models.ReportNoteRequest, operatorID string) error {
	return s.Repo.AddReportNote(ctx, id, operatorID, req.Content)
}

func (s *DataService) ResolveReport(ctx context.Context, id string, req models.ReportResolveRequest, operatorID string) error {
	return s.Repo.ResolveReport(ctx, id, req.Conclusion, joinActions(req.DisposeActions), operatorID, req.Reason)
}

func (s *DataService) RejectReport(ctx context.Context, id string, req models.ReportResolveRequest, operatorID string) error {
	return s.Repo.RejectReport(ctx, id, operatorID, req.Reason)
}

func (s *DataService) ReopenReport(ctx context.Context, id string, req models.ReportResolveRequest, operatorID string) error {
	return s.Repo.ReopenReport(ctx, id, operatorID, req.Reason)
}

func (s *DataService) ListReportActions(ctx context.Context, id string) ([]models.ReportAction, error) {
	return s.Repo.ListReportActions(ctx, id)
}

func joinActions(actions []string) string {
	return strings.Join(actions, ",")
}
