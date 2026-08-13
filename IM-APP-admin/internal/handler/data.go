package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// DataHandler 用户/群组/转发/短信/运营配置管理
type DataHandler struct {
	Data  *service.DataService
	Admin *service.AdminService
}

// ===== 用户管理 =====
func (h *DataHandler) ListUsers(c *gin.Context) {
	if !requirePerm(c, h.Admin, "user.list") {
		return
	}
	page, size := pageParams(c)
	list, err := h.Data.ListUsers(c.Request.Context(), c.Query("keyword"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) GetUser(c *gin.Context) {
	if !requirePerm(c, h.Admin, "user.view") {
		return
	}
	u, err := h.Data.GetUserDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "用户不存在")
		return
	}
	response.OK(c, u)
}

func (h *DataHandler) UpdateUserStatus(c *gin.Context) {
	if !requirePerm(c, h.Admin, "user.update") {
		return
	}
	var req models.UpdateUserStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Status == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.UpdateUserStatus(c.Request.Context(), c.Param("id"), req.Status); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	h.Admin.LogOperation(c.Request.Context(), middleware.AdminID(c), "user.status", "user", c.Param("id"), req.Status, c.ClientIP())
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ListUserReports(c *gin.Context) {
	if !requirePerm(c, h.Admin, "user.view") {
		return
	}
	page, size := pageParams(c)
	list, err := h.Data.ListUserReports(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

// ===== 群组管理 =====
func (h *DataHandler) ListGroups(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.list") {
		return
	}
	page, size := pageParams(c)
	list, err := h.Data.ListGroups(c.Request.Context(), c.Query("keyword"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) ListGroupMembers(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.view") {
		return
	}
	list, err := h.Data.ListGroupMembers(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) UpdateGroupStatus(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.update") {
		return
	}
	var req models.UpdateGroupStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Status == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.UpdateGroupStatus(c.Request.Context(), c.Param("id"), req.Status); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	h.Admin.LogOperation(c.Request.Context(), middleware.AdminID(c), "group.status", "group", c.Param("id"), req.Status, c.ClientIP())
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) MuteGroupAll(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.update") {
		return
	}
	var req struct {
		Muted bool `json:"muted"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.MuteGroupAll(c.Request.Context(), c.Param("id"), req.Muted); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ListGroupRecallLogs(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.view") {
		return
	}
	page, size := pageParams(c)
	list, err := h.Data.ListGroupRecallLogs(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

// ===== 转发任务 =====
func (h *DataHandler) ListForwardTasks(c *gin.Context) {
	if !requirePerm(c, h.Admin, "forward.list") {
		return
	}
	page, size := pageParams(c)
	list, err := h.Data.ListForwardTasks(c.Request.Context(), c.Query("status"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

// ===== 短信记录 =====
func (h *DataHandler) ListSmsLogs(c *gin.Context) {
	if !requirePerm(c, h.Admin, "sms.view") {
		return
	}
	page, size := pageParams(c)
	list, err := h.Data.ListSmsLogs(c.Request.Context(), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

// ===== 运营配置 =====
func (h *DataHandler) ListAppVersions(c *gin.Context) {
	if !requirePerm(c, h.Admin, "version.view") {
		return
	}
	list, err := h.Data.ListAppVersions(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) CreateAppVersion(c *gin.Context) {
	if !requirePerm(c, h.Admin, "version.update") {
		return
	}
	var req models.AppVersion
	if err := c.ShouldBindJSON(&req); err != nil || req.Version == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.CreateAppVersion(c.Request.Context(), req); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ListPolicies(c *gin.Context) {
	if !requirePerm(c, h.Admin, "policy.view") {
		return
	}
	list, err := h.Data.ListPolicies(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) SavePolicy(c *gin.Context) {
	if !requirePerm(c, h.Admin, "policy.update") {
		return
	}
	var req models.AppPolicy
	if err := c.ShouldBindJSON(&req); err != nil || req.Type == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.SavePolicy(c.Request.Context(), req); err != nil {
		response.Fail(c, http.StatusBadRequest, "保存失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) ListSensitiveWords(c *gin.Context) {
	if !requirePerm(c, h.Admin, "sensitive.view") {
		return
	}
	list, err := h.Data.ListSensitiveWords(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) CreateSensitiveWord(c *gin.Context) {
	if !requirePerm(c, h.Admin, "sensitive.update") {
		return
	}
	var req models.SensitiveWord
	if err := c.ShouldBindJSON(&req); err != nil || req.Word == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.CreateSensitiveWord(c.Request.Context(), req); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *DataHandler) DeleteSensitiveWord(c *gin.Context) {
	if !requirePerm(c, h.Admin, "sensitive.update") {
		return
	}
	if err := h.Data.DeleteSensitiveWord(c.Request.Context(), c.Param("id")); err != nil {
		response.Fail(c, http.StatusBadRequest, "删除失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// ===== 国家/地区启停 =====
func (h *DataHandler) ListCountries(c *gin.Context) {
	if !requirePerm(c, h.Admin, "sms.view") {
		return
	}
	list, err := h.Data.ListCountries(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *DataHandler) UpdateCountry(c *gin.Context) {
	if !requirePerm(c, h.Admin, "sms.update") {
		return
	}
	var req models.UpdateCountryRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Data.UpdateCountry(c.Request.Context(), c.Param("code"), *req.Enabled); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	h.Admin.LogOperation(c.Request.Context(), middleware.AdminID(c), "country.update", "country", c.Param("code"), "", c.ClientIP())
	response.OK(c, gin.H{"ok": true})
}

// ===== 群详情与设置 =====
func (h *DataHandler) GetGroupDetail(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.view") {
		return
	}
	g, err := h.Data.GetGroupDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "群不存在")
		return
	}
	response.OK(c, g)
}

func (h *DataHandler) UpdateGroupSettings(c *gin.Context) {
	if !requirePerm(c, h.Admin, "group.update") {
		return
	}
	var req models.UpdateGroupSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if req.JoinMode != nil && *req.JoinMode != "direct" && *req.JoinMode != "approval" {
		response.Fail(c, http.StatusBadRequest, "joinMode 不合法")
		return
	}
	if err := h.Data.UpdateGroupSettings(c.Request.Context(), c.Param("id"), req); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	h.Admin.LogOperation(c.Request.Context(), middleware.AdminID(c), "group.settings", "group", c.Param("id"), "", c.ClientIP())
	response.OK(c, gin.H{"ok": true})
}
