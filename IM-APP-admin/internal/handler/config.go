package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== APP 与公共配置（清单 08） =====

func (h *OpsHandler) ListAppVersions(c *gin.Context) {
	list, err := h.Svc.ListAppVersions(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) CreateAppVersion(c *gin.Context) {
	var v models.AppVersion
	if err := c.ShouldBindJSON(&v); err != nil || v.Version == "" {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.CreateAppVersion(c.Request.Context(), v); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	c.Set("auditReason", "创建版本 "+v.Version)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) UpdateAppVersion(c *gin.Context) {
	var v models.AppVersion
	if err := c.ShouldBindJSON(&v); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.UpdateAppVersion(c.Request.Context(), c.Param("id"), v); err != nil {
		response.Fail(c, http.StatusBadRequest, "更新失败："+err.Error())
		return
	}
	c.Set("auditReason", "修改版本")
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) SetAppVersionStatus(c *gin.Context) {
	var req models.AppVersionStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.SetAppVersionStatus(c.Request.Context(), c.Param("id"), req.Status); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) ListLegalDocuments(c *gin.Context) {
	list, err := h.Svc.ListLegalDocuments(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) CreateLegalDocument(c *gin.Context) {
	var req models.LegalDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	id, err := h.Svc.CreateLegalDocument(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"id": id})
}

func (h *OpsHandler) PublishLegalDocument(c *gin.Context) {
	var req response.AdminActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.PublishLegalDocument(c.Request.Context(), c.Param("id")); err != nil {
		response.Fail(c, http.StatusBadRequest, "发布失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) ListReportReasons(c *gin.Context) {
	list, err := h.Svc.ListReportReasons(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) CreateReportReason(c *gin.Context) {
	var x models.ReportReason
	if err := c.ShouldBindJSON(&x); err != nil || x.Reason == "" {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.CreateReportReason(c.Request.Context(), x); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) UpdateReportReason(c *gin.Context) {
	var x models.ReportReason
	if err := c.ShouldBindJSON(&x); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.UpdateReportReason(c.Request.Context(), c.Param("id"), x); err != nil {
		response.Fail(c, http.StatusBadRequest, "更新失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) SetReportReasonStatus(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=active disabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.SetReportReasonStatus(c.Request.Context(), c.Param("id"), req.Status); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) GetSystemLimits(c *gin.Context) {
	l, err := h.Svc.GetSystemLimits(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, l)
}

func (h *OpsHandler) SaveSystemLimits(c *gin.Context) {
	var req models.SystemLimitsRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.SaveSystemLimits(c.Request.Context(), req.Limits, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "保存失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) PublishSystemLimits(c *gin.Context) {
	var req response.AdminActionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.PublishSystemLimits(c.Request.Context(), middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "发布失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}
