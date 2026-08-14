package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== 敏感词与资料审核（清单 09） =====

func (h *OpsHandler) ListSensitiveWords(c *gin.Context) {
	list, err := h.Svc.ListSensitiveWords(c.Request.Context(), c.Query("keyword"))
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) CreateSensitiveWord(c *gin.Context) {
	var w models.SensitiveWord
	if err := c.ShouldBindJSON(&w); err != nil || w.Word == "" {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.CreateSensitiveWord(c.Request.Context(), w); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) ImportSensitiveWords(c *gin.Context) {
	var req models.SensitiveWordImportRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	n, err := h.Svc.ImportSensitiveWords(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "导入失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"imported": n})
}

func (h *OpsHandler) UpdateSensitiveWord(c *gin.Context) {
	var w models.SensitiveWord
	if err := c.ShouldBindJSON(&w); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.UpdateSensitiveWord(c.Request.Context(), c.Param("id"), w); err != nil {
		response.Fail(c, http.StatusBadRequest, "更新失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) SetSensitiveWordStatus(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=active disabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.SetSensitiveWordStatus(c.Request.Context(), c.Param("id"), req.Status); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) ListModerationHits(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListModerationHits(c.Request.Context(), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *OpsHandler) ListProfileModerations(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListProfileModerations(c.Request.Context(), c.Query("status"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

// ApproveProfile 同意资料审核：pending → approved
func (h *OpsHandler) ApproveProfile(c *gin.Context) {
	var req struct {
		Field  string `json:"field" binding:"required"`
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.ApproveProfile(c.Request.Context(), c.Param("userId"), req.Field, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", "同意资料审核："+req.Field)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) RejectProfile(c *gin.Context) {
	var req struct {
		Field  string `json:"field" binding:"required"`
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.RejectProfile(c.Request.Context(), c.Param("userId"), req.Field, req.Reason, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

// RestoreProfile 恢复待审核（重新进入队列）：rejected/approved → pending
func (h *OpsHandler) RestoreProfile(c *gin.Context) {
	var req struct {
		Field  string `json:"field" binding:"required"`
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.ReopenProfile(c.Request.Context(), c.Param("userId"), req.Field, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", "恢复待审核："+req.Field)
	response.OK(c, gin.H{"ok": true})
}
