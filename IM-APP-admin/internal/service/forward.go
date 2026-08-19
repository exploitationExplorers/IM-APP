package service

import (
	"context"
	"encoding/json"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"
)

// OpsService 转发/国家短信/配置/敏感词/审计/工作台
type OpsService struct {
	Repo              *repository.OpsRepo
	ServerBaseURL     string // server 地址（方案 A：写操作走 server 执行+OpenIM 同步）
	ServerInternalKey string
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

// CancelForwardTask 终止转发任务：方案 A —— 调 server（含队列逻辑）
func (s *OpsService) CancelForwardTask(ctx context.Context, id, operatorID, reason string) error {
	_, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/forward-tasks/"+id+"/cancel",
		map[string]any{"adminId": operatorID, "reason": reason})
	return err
}

// RetryFailedTargets 重试失败目标：方案 A —— 调 server（含队列逻辑）
func (s *OpsService) RetryFailedTargets(ctx context.Context, id, operatorID string) (int64, error) {
	body, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/forward-tasks/"+id+"/retry",
		map[string]any{"adminId": operatorID})
	if err != nil {
		return 0, err
	}
	var res struct {
		Retried int64 `json:"retried"`
	}
	if err := json.Unmarshal(body, &res); err == nil {
		return res.Retried, nil
	}
	return 0, nil
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
