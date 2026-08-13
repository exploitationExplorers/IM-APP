package service

import (
	"context"
	"errors"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

// AdminService 管理员认证、账号、角色权限、操作日志
type AdminService struct {
	Repo *repository.AdminRepo
}

func (s *AdminService) Login(ctx context.Context, username, password string) (models.Admin, error) {
	admin, pwd, err := s.Repo.FindByUsername(ctx, username)
	if err != nil || admin.Status != "active" {
		return models.Admin{}, errors.New("账号或密码错误")
	}
	if bcrypt.CompareHashAndPassword([]byte(pwd), []byte(password)) != nil {
		return models.Admin{}, errors.New("账号或密码错误")
	}
	_ = s.Repo.UpdateLastLogin(ctx, admin.ID)
	return admin, nil
}

func (s *AdminService) HasPermission(ctx context.Context, adminID, permission string) (bool, error) {
	return s.Repo.HasPermission(ctx, adminID, permission)
}

func (s *AdminService) ListAdmins(ctx context.Context) ([]models.Admin, error) {
	return s.Repo.ListAdmins(ctx)
}

func (s *AdminService) CreateAdmin(ctx context.Context, req models.AdminRequest) error {
	b, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	return s.Repo.CreateAdmin(ctx, req.Username, string(b), req.Nickname, req.RoleID, req.Status)
}

func (s *AdminService) UpdateAdmin(ctx context.Context, id string, req models.AdminRequest) error {
	newHash := ""
	if req.Password != "" {
		b, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		newHash = string(b)
	}
	return s.Repo.UpdateAdmin(ctx, id, req.Nickname, req.RoleID, req.Status, newHash)
}

func (s *AdminService) ListRoles(ctx context.Context) ([]models.Role, error) {
	return s.Repo.ListRoles(ctx)
}

func (s *AdminService) CreateRole(ctx context.Context, name, desc string) (string, error) {
	return s.Repo.CreateRole(ctx, name, desc)
}

func (s *AdminService) SetRolePermissions(ctx context.Context, roleID string, perms []string) error {
	return s.Repo.SetRolePermissions(ctx, roleID, perms)
}

func (s *AdminService) ListOperationLogs(ctx context.Context, limit, offset int) ([]models.OperationLog, error) {
	return s.Repo.ListOperationLogs(ctx, limit, offset)
}

func (s *AdminService) LogOperation(ctx context.Context, adminID, action, targetType, targetID, detail, ip string) {
	_ = s.Repo.LogOperation(ctx, adminID, action, targetType, targetID, detail, ip)
}
