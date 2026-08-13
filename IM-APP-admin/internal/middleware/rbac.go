package middleware

import (
	"context"

	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// PermissionChecker 权限校验接口，由 repository 实现
type PermissionChecker interface {
	// HasPermission 返回管理员是否拥有某权限点
	HasPermission(ctx context.Context, adminID, permission string) (bool, error)
	// IsSuperAdmin 是否为超级管理员
	IsSuperAdmin(ctx context.Context, adminID string) (bool, error)
}

// RequirePermission 权限校验中间件（清单 3.2：所有越权请求返回 403）
// 校验失败会记录权限拒绝审计（由 Audit 中间件统一处理 denied 结果）
func RequirePermission(checker PermissionChecker, permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminID := AdminID(c)
		if adminID == "" {
			response.Unauthorized(c, "缺少登录凭证")
			c.Abort()
			return
		}
		super, err := checker.IsSuperAdmin(c.Request.Context(), adminID)
		if err == nil && super {
			c.Next()
			return
		}
		ok, err := checker.HasPermission(c.Request.Context(), adminID, permission)
		if err != nil {
			response.Fail(c, 500, "权限校验失败")
			c.Abort()
			return
		}
		if !ok {
			// 标记审计为 denied（Audit 中间件会写权限拒绝记录）
			c.Set("auditDenied", true)
			c.Set("auditPermission", permission)
			response.Forbidden(c, "无权限操作")
			c.Abort()
			return
		}
		c.Set("auditPermission", permission)
		c.Next()
	}
}
