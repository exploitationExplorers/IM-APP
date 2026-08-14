package handler

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// AuthHandler 管理员登录、MFA、会话、本人资料
type AuthHandler struct {
	Svc     *service.AuthService
	Limiter *middleware.LoginLimiter
}

func requestID(c *gin.Context) string {
	if v, ok := c.Get(response.RequestIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// Login 密码登录（公共接口；失败锁定 + 登录日志）
func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	ip := middleware.ClientIP(c)
	rid := requestID(c)
	ua := c.Request.UserAgent()
	key := req.Username + "|" + ip

	if locked, remain := h.Limiter.IsLocked(key); locked {
		_ = h.Svc.Auth.InsertLoginLog(c.Request.Context(), "", false, "locked", ip, ua, rid)
		response.FailWithCode(c, http.StatusTooManyRequests, 429,
			fmt.Sprintf("登录失败次数过多，请 %s 后再试", remain.Round(time.Minute)))
		return
	}

	result, err := h.Svc.Login(c.Request.Context(), req.Username, req.Password, "", ip, ua, rid)
	if err != nil {
		if errors.Is(err, service.ErrMFARequired) {
			response.OK(c, result) // 需要二次验证，返回 mfaChallenge
			return
		}
		h.Limiter.RecordFailure(key)
		msg := "账号或密码错误"
		status := http.StatusUnauthorized
		switch {
		case errors.Is(err, service.ErrAccountDisabled):
			msg = "账号已停用"
		case errors.Is(err, service.ErrInvalidCredentials):
			// 保持默认
		default:
			status = http.StatusInternalServerError
			msg = "登录失败"
		}
		response.FailErr(c, status, msg, err)
		return
	}
	h.Limiter.Clear(key)
	response.OK(c, result)
}

// MFAVerify 二次验证：校验挑战 token + TOTP 码，签发正式 token
func (h *AuthHandler) MFAVerify(c *gin.Context) {
	var req struct {
		ChallengeToken string `json:"challengeToken" binding:"required"`
		Code           string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	ip := middleware.ClientIP(c)
	result, err := h.Svc.VerifyMFA(c.Request.Context(), req.ChallengeToken, req.Code, "", ip, c.Request.UserAgent(), requestID(c))
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, err.Error())
		return
	}
	response.OK(c, result)
}

// Refresh 刷新 token（旋转 refresh）
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	result, err := h.Svc.Refresh(c.Request.Context(), req.RefreshToken, "", middleware.ClientIP(c))
	if err != nil {
		response.Unauthorized(c, err.Error())
		return
	}
	response.OK(c, result)
}

// Logout 退出当前会话
func (h *AuthHandler) Logout(c *gin.Context) {
	var req models.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.Logout(c.Request.Context(), req.RefreshToken); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// LogoutAll 退出全部后台会话
func (h *AuthHandler) LogoutAll(c *gin.Context) {
	if err := h.Svc.LogoutAll(c.Request.Context(), middleware.AdminID(c)); err != nil {
		response.FailErr(c, 500, "操作失败", err)
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// Me 当前管理员资料与权限
func (h *AuthHandler) Me(c *gin.Context) {
	me, err := h.Svc.Me(c.Request.Context(), middleware.AdminID(c))
	if err != nil {
		response.FailErr(c, http.StatusNotFound, "管理员不存在", err)
		return
	}
	response.OK(c, me)
}

// ChangePassword 修改本人密码
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req models.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.ChangePassword(c.Request.Context(), middleware.AdminID(c), req.OldPassword, req.NewPassword); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// MFAStatus 返回 MFA 状态；未启用时返回 secret 供绑定
func (h *AuthHandler) MFAStatus(c *gin.Context) {
	adminID := middleware.AdminID(c)
	secret, enabled, err := h.Svc.MFAStatus(c.Request.Context(), adminID)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	payload := gin.H{"enabled": enabled}
	if !enabled {
		payload["secret"] = secret
	}
	response.OK(c, payload)
}

// MFASetup 验证 TOTP 码后启用 MFA
func (h *AuthHandler) MFASetup(c *gin.Context) {
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.SetupMFA(c.Request.Context(), middleware.AdminID(c), req.Code); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// MFADisable 关闭 MFA
func (h *AuthHandler) MFADisable(c *gin.Context) {
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Svc.DisableMFA(c.Request.Context(), middleware.AdminID(c), req.Code); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}
