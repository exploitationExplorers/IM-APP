package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== 群组管理（清单 04） =====

func (h *DataHandler) ListGroups(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListGroups(c.Request.Context(), c.Query("keyword"), c.Query("status"), page, size)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *DataHandler) GetGroup(c *gin.Context) {
	g, err := h.Data.GetGroupDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "群不存在")
		return
	}
	response.OK(c, g)
}

func (h *DataHandler) ListGroupMembers(c *gin.Context) {
	list, err := h.Data.ListGroupMembers(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) ListGroupReports(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListGroupReports(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *DataHandler) SetGroupMuteAll(c *gin.Context) {
	var req models.MuteAllRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.SetGroupMuteAll(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) SetGroupAddFriend(c *gin.Context) {
	var req models.MemberAddFriendRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.SetGroupAddFriend(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) DissolveGroup(c *gin.Context) {
	var req models.DissolveRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Data.DissolveGroup(c.Request.Context(), c.Param("id"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ListGroupRecallLogs(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Data.ListGroupRecallLogs(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *DataHandler) RecallMessage(c *gin.Context) {
	var req models.AdminRecallRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因/工单")
		return
	}
	if err := h.Data.RecallMessage(c.Request.Context(), c.Param("id"), c.Param("messageId"), req, middleware.AdminID(c)); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}
