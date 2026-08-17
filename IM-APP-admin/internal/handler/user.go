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
}

// ===== 用户管理（清单 03） =====

func (h *DataHandler) ListUsers(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListUsers(c.Request.Context(), c.Query("keyword"), c.Query("status"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
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
