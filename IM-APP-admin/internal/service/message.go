package service

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 消息发送记录与失败排查 =====

func (s *OpsService) ListMessages(ctx context.Context, f models.MessageAuditFilter, page, size int) ([]models.MessageRecord, int64, error) {
	return s.Repo.ListMessages(ctx, f, size, (page-1)*size)
}

func (s *OpsService) ListMessageFailures(ctx context.Context, f models.MessageFailureFilter, page, size int) ([]models.MessageFailure, int64, error) {
	return s.Repo.ListMessageFailures(ctx, f, size, (page-1)*size)
}
