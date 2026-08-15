package handler

import (
	"errors"
	"net/http"
	"strconv"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// RBACHandler 管理员、角色、权限与审计查询
type RBACHandler struct {
	Svc *service.RBACService
}

func pageParams(c *gin.Context) (int, int) {
	page := atoi(c.Query("page"), 1)
	size := atoi(c.Query("size"), 20)
	if size > 100 {
		size = 100
	}
	if page < 1 {
		page = 1
	}
	return page, size
}

func atoi(s string, def int) int {
	if s == "" {
		return def
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// clampInt 将 v 钳制到 [lo, hi]，用于 days 等查询参数防超大值
func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func id64(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}

// ===== 管理员 =====

func (h *RBACHandler) ListAdmins(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListAdmins(c.Request.Context(), c.Query("keyword"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *RBACHandler) CreateAdmin(c *gin.Context) {
	var req models.AdminCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.CreateAdmin(c.Request.Context(), middleware.AdminID(c), req); err != nil {
		response.FailErr(c, http.StatusBadRequest, "创建失败", err)
		return
	}
	c.Set("auditReason", "创建管理员 "+req.Username)
	response.OK(c, gin.H{"ok": true})
}

func (h *RBACHandler) UpdateAdmin(c *gin.Context) {
	var req models.AdminUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.UpdateAdmin(c.Request.Context(), middleware.AdminID(c), c.Param("id"), req); err != nil {
		response.FailErr(c, http.StatusBadRequest, "更新失败", err)
		return
	}
	c.Set("auditReason", "修改管理员")
	response.OK(c, gin.H{"ok": true})
}

func (h *RBACHandler) SetAdminStatus(c *gin.Context) {
	var req models.AdminStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.SetAdminStatus(c.Request.Context(), c.Param("id"), req.Status); err != nil {
		msg := err.Error()
		if errors.Is(err, service.ErrLastSuperAdmin) {
			msg = "不能停用系统中最后一个可用超级管理员"
		}
		response.FailErr(c, http.StatusBadRequest, msg, err)
		return
	}
	c.Set("auditReason", req.Reason+" 状态->"+req.Status)
	response.OK(c, gin.H{"ok": true})
}

func (h *RBACHandler) ResetMFA(c *gin.Context) {
	var req models.MFAResetRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.Svc.ResetMFA(c.Request.Context(), c.Param("id")); err != nil {
		response.FailErr(c, http.StatusBadRequest, "重置失败", err)
		return
	}
	c.Set("auditReason", req.Reason+" 重置 MFA")
	response.OK(c, gin.H{"ok": true})
}

// ===== 角色 =====

func (h *RBACHandler) ListRoles(c *gin.Context) {
	list, err := h.Svc.ListRoles(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *RBACHandler) CreateRole(c *gin.Context) {
	var req models.RoleCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	id, err := h.Svc.CreateRole(c.Request.Context(), req)
	if err != nil {
		response.FailErr(c, http.StatusBadRequest, "创建失败", err)
		return
	}
	c.Set("auditReason", "创建角色 "+req.Name)
	response.OK(c, gin.H{"id": id})
}

func (h *RBACHandler) UpdateRole(c *gin.Context) {
	var req models.RoleUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.UpdateRole(c.Request.Context(), c.Param("id"), req); err != nil {
		response.FailErr(c, http.StatusBadRequest, "更新失败", err)
		return
	}
	c.Set("auditReason", "修改角色及权限")
	response.OK(c, gin.H{"ok": true})
}

func (h *RBACHandler) DeleteRole(c *gin.Context) {
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := h.Svc.DeleteRole(c.Request.Context(), c.Param("id")); err != nil {
		response.FailErr(c, http.StatusBadRequest, "删除失败：内置角色或已被使用", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *RBACHandler) ListPermissions(c *gin.Context) {
	list, err := h.Svc.ListPermissions(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

// ===== 审计 / 登录日志 =====

func (h *RBACHandler) ListAuditLogs(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListAuditLogs(c.Request.Context(), c.Query("keyword"), c.Query("result"), c.Query("resource"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *RBACHandler) GetAuditLog(c *gin.Context) {
	id, err := id64(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	log, err := h.Svc.GetAuditLog(c.Request.Context(), id)
	if err != nil {
		response.FailErr(c, http.StatusNotFound, "记录不存在", err)
		return
	}
	response.OK(c, log)
}

func (h *RBACHandler) ListLoginLogs(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListLoginLogs(c.Request.Context(), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

// requireReason 写操作统一校验原因（清单 3.2：所有写操作必须填写原因）
func requireReason(c *gin.Context, req *response.AdminActionRequest) bool {
	if err := c.ShouldBindJSON(req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写操作原因")
		return false
	}
	return true
}
