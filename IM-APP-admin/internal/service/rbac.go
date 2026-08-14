package service

import (
	"context"
	"errors"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

var ErrLastSuperAdmin = errors.New("不能停用/删除系统中最后一个可用超级管理员")

// RBACService 管理员账号、角色、权限与审计查询
type RBACService struct {
	Rbac  *repository.RBACRepo
	Auth  *repository.AuthRepo
	Audit *repository.AuditRepo
}

// ===== 管理员账号 =====

func (s *RBACService) ListAdmins(ctx context.Context, keyword string, page, size int) ([]models.AdminAccount, int64, error) {
	accounts, total, err := s.Rbac.ListAdmins(ctx, keyword, size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	return s.Rbac.FillRoles(ctx, accounts), total, nil
}

func (s *RBACService) CreateAdmin(ctx context.Context, req models.AdminCreateRequest) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.Rbac.CreateAdmin(ctx, req, string(hash))
	return err
}

func (s *RBACService) UpdateAdmin(ctx context.Context, id string, req models.AdminUpdateRequest) error {
	newHash := ""
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		newHash = string(hash)
	}
	return s.Rbac.UpdateAdmin(ctx, id, req, newHash)
}

// SetAdminStatus 启用/停用管理员；停用时其全部会话立即失效
func (s *RBACService) SetAdminStatus(ctx context.Context, id, status string) error {
	if status == "disabled" {
		super, err := s.Rbac.IsSuperAdmin(ctx, id)
		if err != nil {
			return err
		}
		if super {
			active, err := s.countActiveSuperAdmins(ctx, id)
			if err != nil {
				return err
			}
			if active <= 1 {
				return ErrLastSuperAdmin
			}
		}
	}
	if err := s.Rbac.UpdateAdminStatus(ctx, id, status); err != nil {
		return err
	}
	if status == "disabled" {
		return s.Auth.RevokeAllSessions(ctx, id)
	}
	return nil
}

// countActiveSuperAdmins 统计除指定管理员外的启用超级管理员数
func (s *RBACService) countActiveSuperAdmins(ctx context.Context, excludeID string) (int, error) {
	var n int
	err := s.Rbac.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM admin_users u
		JOIN admin_user_roles ur ON ur.admin_id = u.id
		JOIN admin_roles ro ON ro.id = ur.role_id
		WHERE ro.code='super_admin' AND u.status='active' AND u.id<>$1::uuid`, excludeID).Scan(&n)
	return n, err
}

// ===== 角色 =====

func (s *RBACService) ListRoles(ctx context.Context) ([]models.AdminRole, error) {
	roles, err := s.Rbac.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	for i := range roles {
		perms, _ := s.Rbac.GetRolePermissions(ctx, roles[i].ID)
		roles[i].Permissions = perms
	}
	return roles, nil
}

func (s *RBACService) CreateRole(ctx context.Context, req models.RoleCreateRequest) (string, error) {
	return s.Rbac.CreateRole(ctx, req)
}

func (s *RBACService) UpdateRole(ctx context.Context, id string, req models.RoleUpdateRequest) error {
	return s.Rbac.UpdateRole(ctx, id, req)
}

// ResetMFA 重置管理员 MFA（需 admins.security 权限）
func (s *RBACService) ResetMFA(ctx context.Context, id string) error {
	return s.Auth.SetMFA(ctx, id, "")
}

// DeleteRole 删除角色；super_admin 不可删除，被删除角色有管理员引用时拒绝
func (s *RBACService) DeleteRole(ctx context.Context, id string) error {
	n, err := s.Rbac.DeleteRole(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		// 可能是 super_admin 或不存在
		return ErrLastSuperAdmin
	}
	return nil
}

func (s *RBACService) ListPermissions(ctx context.Context) ([]models.AdminPermission, error) {
	return s.Rbac.ListPermissions(ctx)
}

// ===== 审计 / 登录日志 =====

func (s *RBACService) ListAuditLogs(ctx context.Context, keyword, result, resource string, page, size int) ([]models.AuditLog, int64, error) {
	return s.Audit.ListAuditLogs(ctx, keyword, result, resource, size, (page-1)*size)
}

func (s *RBACService) GetAuditLog(ctx context.Context, id int64) (*models.AuditLog, error) {
	return s.Audit.GetAuditLog(ctx, id)
}

func (s *RBACService) ListLoginLogs(ctx context.Context, page, size int) ([]models.LoginLog, int64, error) {
	return s.Auth.ListLoginLogs(ctx, size, (page-1)*size)
}
