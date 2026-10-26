package handler

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"im-app-server/internal/middleware"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"
	"net/http"
)

type AccountDeletionService interface {
	Delete(context.Context, string, string) error
}
type AccountHandler struct {
	Svc      AccountDeletionService
	Accounts service.AccountRepository
}

func (h *AccountHandler) Requirements(c *gin.Context) {
	count, err := h.Accounts.OwnedGroupCount(c.Request.Context(), middleware.UserID(c))
	if err != nil {
		response.Fail(c, 503, "暂时无法检查账号，请稍后重试")
		return
	}
	response.OK(c, gin.H{"canDelete": count == 0, "ownedGroupCount": count})
}

func (h *AccountHandler) Delete(c *gin.Context) {
	var req struct {
		Password  string `json:"password"`
		Confirmed bool   `json:"confirmed"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if err := c.ShouldBindJSON(&req); err != nil || !req.Confirmed || req.Password == "" || len(req.Password) > 72 {
		response.Fail(c, 400, "请输入登录密码并确认注销")
		return
	}
	if err := h.Svc.Delete(c.Request.Context(), middleware.UserID(c), req.Password); err != nil {
		switch {
		case errors.Is(err, service.ErrAccountPassword):
			response.Fail(c, 400, err.Error())
		case errors.Is(err, repository.ErrAccountOwnsGroups), errors.Is(err, repository.ErrAccountChanged):
			response.Fail(c, 409, err.Error())
		case errors.Is(err, service.ErrForbidden):
			response.Unauthorized(c, "账号已不可用")
		default:
			response.Fail(c, 503, "注销失败，请稍后重试")
		}
		return
	}
	response.OK(c, gin.H{"ok": true, "imCleanupPending": true})
}
