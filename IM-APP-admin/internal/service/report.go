package service

import (
	"context"
	"fmt"
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
	if err := s.Repo.ResolveReport(ctx, id, req.Conclusion, joinActions(req.DisposeActions), operatorID, req.Reason); err != nil {
		return err
	}
	return s.autoBanOnReports(ctx, id)
}

// reportBanThreshold 用户被成立举报达阈值自动封禁（举报和封禁联动，清单 12.2）
const reportBanThreshold = 3

// autoBanOnReports 举报联动：目标为用户且被成立举报达阈值时，调 server 自动封禁（方案 A）
func (s *DataService) autoBanOnReports(ctx context.Context, reportID string) error {
	rp, err := s.Repo.GetReport(ctx, reportID)
	if err != nil || rp.TargetType != "user" {
		return nil // 非用户举报不联动
	}
	cnt, err := s.Repo.CountResolvedReports(ctx, "user", rp.TargetID)
	if err != nil {
		return err
	}
	if cnt >= reportBanThreshold {
		_, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
			"/internal/admin/users/"+rp.TargetID+"/status",
			map[string]any{"status": "banned", "reason": fmt.Sprintf("被成立举报达 %d 次自动封禁", cnt)})
		return err
	}
	return nil
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
