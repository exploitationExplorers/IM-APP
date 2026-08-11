package handler

import (
	"net/http"

	"im-app-server/internal/im"
	"im-app-server/internal/middleware"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
)

type IMHandler struct {
	Client *im.Client
}

type imTokenReq struct {
	PlatformID int `json:"platformId"`
}

func (h *IMHandler) Token(c *gin.Context) {
	uid := middleware.UserID(c)
	var req imTokenReq
	_ = c.ShouldBindJSON(&req)
	result, err := h.Client.IssueUserToken(c.Request.Context(), uid, req.PlatformID)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "获取 IM Token 失败")
		return
	}
	response.OK(c, result)
}
