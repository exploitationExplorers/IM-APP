package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== 举报与内容处置（清单 05） =====

func (h *DataHandler) ListReports(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListReports(c.Request.Context(), c.Query("status"), c.Query("targetType"), c.Query("keyword"), page, size)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *DataHandler) GetReport(c *gin.Context) {
	rp, err := h.Data.GetReport(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "举报不存在")
		return
	}
	response.OK(c, rp)
}

func (h *DataHandler) AssignReport(c *gin.Context) {
	var req models.ReportAssignRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.AssignReport(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) StartReport(c *gin.Context) {
	if err := h.Data.StartReport(c.Request.Context(), c.Param("id"), middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) AddReportNote(c *gin.Context) {
	var req models.ReportNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Content == "" {
		response.BadRequest(c, "备注不能为空")
		return
	}
	if err := h.Data.AddReportNote(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ResolveReport(c *gin.Context) {
	var req models.ReportResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.ResolveReport(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) RejectReport(c *gin.Context) {
	var req models.ReportResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.RejectReport(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ReopenReport(c *gin.Context) {
	var req models.ReportResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.ReopenReport(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ListReportActions(c *gin.Context) {
	list, err := h.Data.ListReportActions(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OK(c, list)
}
