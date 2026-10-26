package handler

// 账号注销 HTTP 层（iOS 上架合规：Apple 5.1.1(v)）
//
// 短信验证码复用 AuthHandler.verifySMSCode：已经涵盖了开发环境通配码、
// 内部万能码、错误次数上限与一次消费，不重复实现一遍。
// 注销用独立 scene（delete_account），与登录/注册的发送额度互不干扰。

import (
	"errors"
	"net/http"

	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type AccountDeletionHandler struct {
	Svc *service.AccountDeletionService
	// Auth 仅用于复用其 verifySMSCode
	Auth *AuthHandler
}

// Preview 注销前置检查：返回阻碍项与影响范围，前端据此决定能否继续。
func (h *AccountDeletionHandler) Preview(c *gin.Context) {
	uid := middleware.UserID(c)
	preview, err := h.Svc.Preview(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "注销检查失败")
		return
	}
	response.OK(c, preview)
}

// Delete 注销当前账号。需要短信验证码 + 二级确认短语。
func (h *AccountDeletionHandler) Delete(c *gin.Context) {
	var req models.DeleteAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if req.Acknowledge != service.AccountDeletionConfirmPhrase {
		response.Fail(c, http.StatusBadRequest, "请先确认注销风险")
		return
	}
	ctx := c.Request.Context()

	e164, err := service.NormalizeE164(req.CountryCode, req.Phone)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "手机号格式不正确")
		return
	}
	if !h.Auth.verifySMSCode(ctx, e164, service.AccountDeletionSMSScene, req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误或已失效")
		return
	}

	result, err := h.Svc.Delete(ctx, service.AccountDeletionInput{
		UserID:           middleware.UserID(c),
		CountryCode:      req.CountryCode,
		Phone:            req.Phone,
		RequestIP:        c.ClientIP(),
		RequestUserAgent: c.Request.UserAgent(),
	})
	if err != nil {
		var blocked *service.AccountDeletionBlockedError
		if errors.As(err, &blocked) {
			// 带上 blockers 让前端能逐条提示并给出跳转入口
			c.JSON(http.StatusConflict, response.Body{
				Code:    1,
				Message: "存在未处理的前置事项",
				Data:    blocked.Blockers,
			})
			return
		}
		if errors.Is(err, service.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "手机号与当前账号不一致")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "注销失败，请稍后重试")
		return
	}
	response.OK(c, result)
}
