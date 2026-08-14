package service

import (
	"context"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"
)

// DataService 用户/群组/举报业务
type DataService struct {
	Repo *repository.DataRepo
}

// ===== 用户 =====

func (s *DataService) ListUsers(ctx context.Context, keyword, status string, page, size int) ([]models.AppUser, int64, error) {
	return s.Repo.ListUsers(ctx, keyword, status, size, (page-1)*size)
}

func (s *DataService) GetUserDetail(ctx context.Context, id string) (*models.AppUserDetail, error) {
	return s.Repo.GetUserDetail(ctx, id)
}

func (s *DataService) RevealPhone(ctx context.Context, id string) (string, error) {
	return s.Repo.RevealPhone(ctx, id)
}

func (s *DataService) ListUserGroups(ctx context.Context, id string) ([]models.AppGroup, error) {
	return s.Repo.ListUserGroups(ctx, id)
}

func (s *DataService) ListUserReports(ctx context.Context, id string, page, size int) ([]models.Report, int64, error) {
	return s.Repo.ListUserReports(ctx, id, size, (page-1)*size)
}

func (s *DataService) ListUserForwardTasks(ctx context.Context, id string, page, size int) ([]models.ForwardTask, int64, error) {
	return s.Repo.ListUserForwardTasks(ctx, id, size, (page-1)*size)
}

// SetRestriction 设置登录/发信限制（不动 users 表，写 user_restrictions）
func (s *DataService) SetRestriction(ctx context.Context, id, restrType string, req models.RestrictionRequest, operatorID string) error {
	return s.Repo.SetRestriction(ctx, id, restrType, *req.Banned, req.Until, req.Reason, operatorID)
}

// BanUser 封禁/解封用户（清单 03.3：封禁撤销会话、停普通离线推送由状态标记表达）
func (s *DataService) BanUser(ctx context.Context, id string, req models.BanRequest, operatorID string) error {
	status := "active"
	if *req.Banned {
		status = "banned"
	}
	return s.Repo.UpdateUserStatus(ctx, id, status, req.Reason, operatorID)
}

func (s *DataService) RevokeSessions(ctx context.Context, id string) error {
	return s.Repo.RevokeUserSessions(ctx, id)
}
