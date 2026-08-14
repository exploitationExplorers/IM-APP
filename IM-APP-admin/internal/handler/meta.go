package handler

import (
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// MetaHandler 后台存活检查与元信息（清单 00.2）
type MetaHandler struct {
	Version   string
	Commit    string
	BuildTime string
}

// Health 后台存活检查：不泄露依赖密钥与详细异常
func (h *MetaHandler) Health(c *gin.Context) {
	response.OK(c, gin.H{"status": "ok"})
}

// Meta 当前后台版本、commit、构建时间和功能开关
func (h *MetaHandler) Meta(c *gin.Context) {
	response.OK(c, gin.H{
		"version":   h.Version,
		"commit":    h.Commit,
		"buildTime": h.BuildTime,
		"features": gin.H{
			"mfa":    true,
			"report": true,
		},
	})
}
