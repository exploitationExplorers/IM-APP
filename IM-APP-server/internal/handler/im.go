package handler

import (
	"errors"
	"io"
	"net/http"

	"im-app-server/internal/im"
	"im-app-server/internal/middleware"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type IMHandler struct {
	Service *service.IMService
}

type imTokenRequest struct {
	PlatformID int `json:"platformId"`
}

// Token keeps the original API contract. User creation/synchronization is a
// backend concern and never requires another call from the client.
func (h *IMHandler) Token(c *gin.Context) {
	var req imTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		response.Fail(c, http.StatusBadRequest, "platformId 不正确")
		return
	}
	// Preserve the original uni-app default.
	if req.PlatformID == 0 {
		req.PlatformID = 5
	}
	result, err := h.Service.Token(c.Request.Context(), middleware.UserID(c), req.PlatformID)
	if err != nil {
		switch {
		case errors.Is(err, im.ErrInvalidPlatform):
			response.Fail(c, http.StatusBadRequest, "platformId 不正确")
		case errors.Is(err, service.ErrIMAccountInactive):
			response.Fail(c, http.StatusForbidden, "账号不可用")
		case errors.Is(err, service.ErrIMUnavailable), errors.Is(err, im.ErrUnavailable):
			response.Fail(c, http.StatusServiceUnavailable, "OpenIM 服务不可用")
		default:
			response.Fail(c, http.StatusBadGateway, "获取 IM Token 失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *IMHandler) Peer(c *gin.Context) {
	peer, err := h.Service.ResolvePeer(c.Request.Context(), middleware.UserID(c), c.Param("businessUserId"))
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrIMTargetNotFound), errors.Is(err, im.ErrInvalidUserID):
			response.Fail(c, http.StatusNotFound, "聊天用户不存在")
		default:
			response.Fail(c, http.StatusInternalServerError, "解析聊天用户失败")
		}
		return
	}
	response.OK(c, peer)
}

func (h *IMHandler) Group(c *gin.Context) {
	group, err := h.Service.ResolveGroup(c.Request.Context(), middleware.UserID(c), c.Param("businessGroupId"))
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrIMTargetNotFound), errors.Is(err, im.ErrInvalidUserID):
			response.Fail(c, http.StatusNotFound, "群聊不存在或无权访问")
		default:
			response.Fail(c, http.StatusInternalServerError, "解析群聊失败")
		}
		return
	}
	response.OK(c, group)
}
