package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// OpsHandler 转发/国家短信/配置/敏感词/审计/工作台
type OpsHandler struct {
	Svc *service.OpsService
}

// ===== 转发/群发与风控（清单 06） =====

func (h *OpsHandler) ListForwardTasks(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListForwardTasks(c.Request.Context(), c.Query("status"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *OpsHandler) GetForwardTask(c *gin.Context) {
	t, err := h.Svc.GetForwardTask(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.FailErr(c, http.StatusNotFound, "任务不存在", err)
		return
	}
	response.OK(c, t)
}

func (h *OpsHandler) ListForwardTargets(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListForwardTargets(c.Request.Context(), c.Param("id"), c.Query("status"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *OpsHandler) ForwardFailures(c *gin.Context) {
	list, err := h.Svc.ForwardFailures(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) CancelForwardTask(c *gin.Context) {
	var req response.AdminActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.CancelForwardTask(c.Request.Context(), c.Param("id"), middleware.AdminID(c), req.Reason); err != nil {
		response.FailErr(c, http.StatusBadRequest, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) RetryForwardTask(c *gin.Context) {
	var req response.AdminActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	n, err := h.Svc.RetryFailedTargets(c.Request.Context(), c.Param("id"), middleware.AdminID(c))
	if err != nil {
		response.FailErr(c, http.StatusBadRequest, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"retried": n})
}

func (h *OpsHandler) GetForwardUserLimit(c *gin.Context) {
	l, err := h.Svc.GetForwardUserLimit(c.Request.Context(), c.Param("userId"))
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, l)
}

func (h *OpsHandler) SetForwardUserLimit(c *gin.Context) {
	var req models.ForwardLimitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.SetForwardUserLimit(c.Request.Context(), c.Param("userId"), req, middleware.AdminID(c)); err != nil {
		response.FailErr(c, http.StatusBadRequest, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) GetForwardSettings(c *gin.Context) {
	s, err := h.Svc.GetForwardSettings(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, s)
}

func (h *OpsHandler) SetForwardSettings(c *gin.Context) {
	var req struct {
		Settings *models.ForwardSettings `json:"settings" binding:"required"`
		Reason   string                  `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "必须填写规则和原因")
		return
	}
	if err := h.Svc.SetForwardSettings(c.Request.Context(), req.Settings, middleware.AdminID(c)); err != nil {
		response.FailErr(c, http.StatusBadRequest, "操作失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}
