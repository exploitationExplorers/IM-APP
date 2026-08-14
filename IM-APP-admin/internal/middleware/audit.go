package middleware

import (
	"context"
	"net/http"
	"strings"

	"im-app-admin/internal/response"
	"im-app-admin/internal/util"

	"github.com/gin-gonic/gin"
)

// AuditLog 审计记录结构
type AuditLog struct {
	AdminID    string
	Action     string
	Resource   string
	ResourceID string
	Reason     string
	Before     string
	After      string
	IP         string
	UserAgent  string
	RequestID  string
	Result     string // success|denied|failed
}

// AuditStore 审计写入接口
type AuditStore interface {
	InsertAudit(ctx context.Context, log *AuditLog) error
}

// Audit 统一审计中间件：所有写操作自动记录（清单 10 / 3.2）
// action=HTTP方法+路由；resource/resource_id 从路径解析；权限拒绝记 result=denied
func Audit(store AuditStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		method := c.Request.Method
		if method != http.MethodPost && method != http.MethodPut &&
			method != http.MethodPatch && method != http.MethodDelete {
			return
		}
		adminID := AdminID(c)
		result := "success"
		if denied, _ := c.Get("auditDenied"); denied == true {
			result = "denied"
		} else if c.Writer.Status() >= 400 {
			result = "failed"
		}

		action := method + " " + c.FullPath()
		resource, resourceID := parseResource(c)

		reason := ""
		if b, err := c.Get("auditReason"); err {
			reason, _ = b.(string)
		}
		if reason == "" {
			reason = extractReason(c)
		}

		reqID, _ := c.Get(response.RequestIDKey)
		reqIDStr, _ := reqID.(string)
		if reqIDStr == "" {
			reqIDStr = util.NewUUID()
		}

		_ = store.InsertAudit(c.Request.Context(), &AuditLog{
			AdminID:    adminID,
			Action:     action,
			Resource:   resource,
			ResourceID: resourceID,
			Reason:     reason,
			IP:         ClientIP(c),
			UserAgent:  truncate(c.Request.UserAgent(), 255),
			RequestID:  reqIDStr,
			Result:     result,
		})
	}
}

// parseResource 从路由路径解析资源与资源 ID：/users/:id/ban -> (user.ban, :id)
func parseResource(c *gin.Context) (string, string) {
	segments := splitPath(c.FullPath())
	if len(segments) == 0 {
		return "unknown", ""
	}
	resource := segments[0]
	resourceID := ""
	// 形如 /users/:id 或 /users/:id/ban
	for i, s := range segments {
		if strings.HasPrefix(s, ":") && i+1 < len(segments) {
			if v := c.Param(strings.TrimPrefix(s, ":")); v != "" {
				resourceID = v
			}
		}
	}
	if len(segments) > 2 && resourceID == "" {
		resourceID = c.Param("id")
	}
	if len(segments) >= 2 {
		if v := c.Param("id"); v != "" {
			resourceID = v
			resource = resource + "." + segments[1]
		} else if len(segments) >= 3 {
			resource = resource + "." + segments[len(segments)-1]
		}
	}
	return resource, resourceID
}

func splitPath(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

// extractReason 尝试从 JSON 请求体提取 reason 字段
func extractReason(c *gin.Context) string {
	body, err := c.Get("auditReasonBody")
	if err {
		if s, ok := body.(string); ok {
			return truncate(s, 500)
		}
	}
	// 大多数写操作 handler 会显式设置 auditReason；此处兜底
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
