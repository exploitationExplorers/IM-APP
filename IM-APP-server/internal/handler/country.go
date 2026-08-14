package handler

import (
	"net/http"

	"im-app-server/internal/repository"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
)

// CountryHandler 公共配置（无需登录）
type CountryHandler struct {
	Repo *repository.CountryRepo
}

// Countries 返回所有启用的国家区号（登录前可用）
func (h *CountryHandler) Countries(c *gin.Context) {
	list, err := h.Repo.ListEnabled(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}
