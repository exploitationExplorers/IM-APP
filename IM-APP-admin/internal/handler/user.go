package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// DataHandler 用户/群组/举报（清单 03/04/05）
type DataHandler struct {
	Data  *service.DataService
	Audit *service.RBACService
	// Perms 用于 handler 内二次权限校验（如按手机号查询需 users.phone.search 权限）
	Perms middleware.PermissionChecker
}

// ===== 用户管理（清单 03） =====

func (h *DataHandler) ListUsers(c *gin.Context) {
	page, size := pageParams(c)
	searchType := c.Query("searchType")
	keyword := c.Query("keyword")
	status := c.Query("status")

	// 手机号查询：隐私操作，须有 users.phone.search 权限，且仅按 phone_e164 匹配
	if searchType == "phone" {
		if !h.canSearchPhone(c) {
			return
		}
		list, total, err := h.Data.SearchUserByPhone(c.Request.Context(), keyword, page, size)
		if err != nil {
			response.FailErr(c, 500, "查询失败", err)
			return
		}
		response.OKPage(c, list, total, page, size)
		return
	}

	list, total, err := h.Data.ListUsers(c.Request.Context(), keyword, status, page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

// canSearchPhone 校验当前管理员是否有按手机号查询权限（超级管理员直接放行）
func (h *DataHandler) canSearchPhone(c *gin.Context) bool {
	if h.Perms == nil {
		response.Forbidden(c, "无权限操作")
		return false
	}
	adminID := middleware.AdminID(c)
	if adminID == "" {
		response.Unauthorized(c, "缺少登录凭证")
		return false
	}
	if super, err := h.Perms.IsSuperAdmin(c.Request.Context(), adminID); err == nil && super {
		return true
	}
	ok, err := h.Perms.HasPermission(c.Request.Context(), adminID, "users.phone.search")
	if err != nil || !ok {
		response.Forbidden(c, "无权限操作")
		return false
	}
	return true
}

func (h *DataHandler) GetUser(c *gin.Context) {
	u, err := h.Data.GetUserDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.FailErr(c, http.StatusNotFound, "用户不存在", err)
		return
	}
	response.OK(c, u)
}

// RevealPhone 查看完整手机号：需权限 + 原因/工单 + 审计（清单 3.2）
func (h *DataHandler) RevealPhone(c *gin.Context) {
	var req models.PhoneRevealRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因和工单号")
		return
	}
	phone, err := h.Data.RevealPhone(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.FailErr(c, http.StatusNotFound, "用户不存在", err)
		return
	}
	c.Set("auditReason", "查看完整手机号："+req.Reason+" 工单:"+req.TicketNo)
	response.OK(c, gin.H{"phone": phone})
}

func (h *DataHandler) ListUserGroups(c *gin.Context) {
	list, err := h.Data.ListUserGroups(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) ListUserReports(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListUserReports(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *DataHandler) ListUserForwardTasks(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListUserForwardTasks(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *DataHandler) SetLoginRestriction(c *gin.Context) {
	h.setRestriction(c, "login")
}

func (h *DataHandler) SetMessageRestriction(c *gin.Context) {
	h.setRestriction(c, "message")
}

func (h *DataHandler) setRestriction(c *gin.Context, restrType string) {
	var req models.RestrictionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" || req.Banned == nil {
		response.BadRequest(c, "必须填写状态和原因")
		return
	}
	if err := h.Data.SetRestriction(c.Request.Context(), c.Param("id"), restrType, req, middleware.AdminID(c)); err != nil {
		response.FailErr(c, http.StatusBadRequest, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

// ResetUserProfile 强制重置用户头像/昵称（方案 A：走 server 更新 + OpenIM 同步）
func (h *DataHandler) ResetUserProfile(c *gin.Context) {
	var req struct {
		Field  string `json:"field" binding:"required,oneof=avatar nickname"`
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "必须填写字段和原因")
		return
	}
	if err := h.Data.ResetProfile(c.Request.Context(), c.Param("id"), req.Field, middleware.AdminID(c), req.Reason); err != nil {
		response.FailErr(c, http.StatusBadRequest, "重置失败", err)
		return
	}
	c.Set("auditReason", req.Reason+" 重置"+req.Field)
	response.OK(c, gin.H{"ok": true})
}

// SearchUserByPhone 按手机号查询用户（需 users.phone.search 权限）
func (h *DataHandler) SearchUserByPhone(c *gin.Context) {
	page, size := pageParams(c)
	phone := c.Query("phone")
	if phone == "" {
		response.BadRequest(c, "phone 必填")
		return
	}
	list, total, err := h.Data.SearchUserByPhone(c.Request.Context(), phone, page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

// CancelUser 注销用户（方案 A：调 server 改状态 + 撤销会话）
func (h *DataHandler) CancelUser(c *gin.Context) {
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.CancelUser(c.Request.Context(), c.Param("id"), req.Reason, middleware.AdminID(c)); err != nil {
		response.FailErr(c, http.StatusBadRequest, "注销失败", err)
		return
	}
	c.Set("auditReason", req.Reason+" 注销用户")
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) BanUser(c *gin.Context) {
	var req models.BanRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" || req.Banned == nil {
		response.BadRequest(c, "必须填写状态和原因")
		return
	}
	if err := h.Data.BanUser(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.FailErr(c, http.StatusBadRequest, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason+" 封禁状态->"+boolStr(*req.Banned))
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) RevokeSessions(c *gin.Context) {
	var req response.AdminActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写操作原因")
		return
	}
	if err := h.Data.RevokeSessions(c.Request.Context(), c.Param("id")); err != nil {
		response.FailErr(c, 500, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
