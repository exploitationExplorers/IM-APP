package service

import (
	"context"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"
)

// DataService 用户/群组/举报业务
type DataService struct {
	Repo             *repository.DataRepo
	ServerBaseURL    string // server 地址（方案 A：写操作走 server 执行+OpenIM 同步）
	ServerInternalKey string // 与 server IM_INTERNAL_API_KEY 一致
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

// SetRestriction 设置登录/发信限制：方案 A —— 调 server（server 登录/发消息强制检查）
func (s *DataService) SetRestriction(ctx context.Context, id, restrType string, req models.RestrictionRequest, operatorID string) error {
	_, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/users/"+id+"/restriction",
		map[string]any{"type": restrType, "banned": *req.Banned, "until": req.Until, "reason": req.Reason})
	return err
}

// BanUser 封禁/解封用户：方案 A —— 调 server（改状态 + 撤销会话 + 强制生效），本地写状态审计
func (s *DataService) BanUser(ctx context.Context, id string, req models.BanRequest, operatorID string) error {
	status := "active"
	if *req.Banned {
		status = "banned"
	}
	if _, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/users/"+id+"/status",
		map[string]any{"status": status, "reason": req.Reason}); err != nil {
		return err
	}
	return s.Repo.LogUserStatusChange(ctx, id, status, req.Reason, operatorID)
}

// RevokeSessions 强制下线：方案 A —— 调 server（撤销 auth_sessions）
func (s *DataService) RevokeSessions(ctx context.Context, id string) error {
	_, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/users/"+id+"/sessions/revoke", map[string]any{})
	return err
}

// ResetProfile 强制重置用户头像/昵称：方案 A —— 调 server（更新 + OpenIM 同步）
func (s *DataService) ResetProfile(ctx context.Context, id, field, operatorID, reason string) error {
	_, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/users/"+id+"/reset-profile",
		map[string]any{"adminId": operatorID, "field": field, "reason": reason})
	return err
}

// SearchUserByPhone 按手机号查询用户（需 users.phone.search 权限，保护隐私）
func (s *DataService) SearchUserByPhone(ctx context.Context, phone string, page, size int) ([]models.AppUser, int64, error) {
	return s.Repo.SearchByPhone(ctx, phone, size, (page-1)*size)
}

// CancelUser 注销用户：方案 A —— 调 server（改状态 + 撤销会话），本地写状态审计
func (s *DataService) CancelUser(ctx context.Context, id string, reason, operatorID string) error {
	if _, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/users/"+id+"/status",
		map[string]any{"status": "cancelled", "reason": reason}); err != nil {
		return err
	}
	return s.Repo.LogUserStatusChange(ctx, id, "cancelled", reason, operatorID)
}
