package handler

import (
	"net/http"

	"im-app-admin/internal/models"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== 国家与短信（清单 07） =====

func (h *OpsHandler) ListCountries(c *gin.Context) {
	list, err := h.Svc.ListCountries(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) CreateCountry(c *gin.Context) {
	var c2 models.Country
	if err := c.ShouldBindJSON(&c2); err != nil || c2.Code == "" {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.CreateCountry(c.Request.Context(), c2); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	c.Set("auditReason", "新增国家 "+c2.Code)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) UpdateCountryStatus(c *gin.Context) {
	var req models.CountryStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写原因")
		return
	}
	if err := h.Svc.UpdateCountryEnabled(c.Request.Context(), c.Param("code"), *req.Enabled); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

func (h *OpsHandler) ListSmsLogs(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListSmsLogs(c.Request.Context(), c.Query("keyword"), c.Query("status"), page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *OpsHandler) GetSmsLog(c *gin.Context) {
	id, err := id64(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	l, err := h.Svc.GetSmsLog(c.Request.Context(), id)
	if err != nil {
		response.FailErr(c, http.StatusNotFound, "记录不存在", err)
		return
	}
	response.OK(c, l)
}

func (h *OpsHandler) SmsStatistics(c *gin.Context) {
	days := atoi(c.Query("days"), 7)
	st, err := h.Svc.SmsStatistics(c.Request.Context(), days)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, st)
}

func (h *OpsHandler) ProviderHealth(c *gin.Context) {
	list, err := h.Svc.ProviderHealth(c.Request.Context())
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OK(c, list)
}
