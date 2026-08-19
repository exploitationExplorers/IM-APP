package handler

import (
	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// MetaHandler 后台存活检查、元信息与功能开关（清单 00.2）
type MetaHandler struct {
	Version   string
	Commit    string
	BuildTime string
	Svc       *service.OpsService
}

func (h *MetaHandler) Health(c *gin.Context) {
	response.OK(c, gin.H{"status": "ok"})
}

// Meta 后台版本、commit、构建时间与功能开关（从配置读取）
func (h *MetaHandler) Meta(c *gin.Context) {
	flags := h.loadFeatureFlags(c)
	response.OK(c, gin.H{
		"version":   h.Version,
		"commit":    h.Commit,
		"buildTime": h.BuildTime,
		"features": gin.H{
			"mfa":    flags.MFA,
			"report": flags.Report,
		},
	})
}

// GetFeatures 获取功能开关
func (h *MetaHandler) GetFeatures(c *gin.Context) {
	response.OK(c, h.loadFeatureFlags(c))
}

// SetFeatures 设置功能开关（传入的字段覆盖，未传的保持原值）
func (h *MetaHandler) SetFeatures(c *gin.Context) {
	var req models.FeatureFlagsRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.BadRequest(c, "必须填写操作原因")
		return
	}
	if h.Svc == nil {
		response.Fail(c, 500, "服务未就绪")
		return
	}
	flags := h.loadFeatureFlags(c)
	if req.MFA != nil {
		flags.MFA = *req.MFA
	}
	if req.Report != nil {
		flags.Report = *req.Report
	}
	if err := h.Svc.SaveFeatureFlags(c.Request.Context(), flags, middleware.AdminID(c)); err != nil {
		response.FailErr(c, 500, "保存失败", err)
		return
	}
	c.Set("auditReason", req.Reason)
	response.OK(c, gin.H{"ok": true})
}

// loadFeatureFlags 读取功能开关（服务未注入时返回默认值）
func (h *MetaHandler) loadFeatureFlags(c *gin.Context) *models.FeatureFlags {
	if h.Svc != nil {
		if f, err := h.Svc.GetFeatureFlags(c.Request.Context()); err == nil && f != nil {
			return f
		}
	}
	return &models.FeatureFlags{MFA: true, Report: true}
}
