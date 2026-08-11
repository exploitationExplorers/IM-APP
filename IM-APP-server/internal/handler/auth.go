package handler

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"im-app-server/internal/config"
	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	DB    *pgxpool.Pool
	Cfg   config.Config
	Redis *infra.Redis
}

type phoneReq struct {
	Phone       string `json:"phone"`
	CountryCode string `json:"countryCode"`
	Password    string `json:"password"`
	Code        string `json:"code"`
	Scene       string `json:"scene"`
}

func (h *AuthHandler) SendSMS(c *gin.Context) {
	var req phoneReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Phone == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	scene := req.Scene
	if scene == "" {
		scene = "login"
	}
	ctx := c.Request.Context()
	if h.Redis != nil {
		ok, err := h.Redis.AllowSMS(ctx, req.Phone)
		if err != nil {
			response.Fail(c, http.StatusInternalServerError, "发送失败")
			return
		}
		if !ok {
			response.Fail(c, http.StatusTooManyRequests, "发送过于频繁，请稍后再试")
			return
		}
	}
	code := h.Cfg.DevSMSCode
	if code == "" {
		code = randomDigits(6)
	}
	_, err := h.DB.Exec(ctx,
		`INSERT INTO sms_codes(phone, scene, code, expires_at) VALUES($1,$2,$3,$4)`,
		req.Phone, scene, code, time.Now().Add(10*time.Minute),
	)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "发送失败")
		return
	}
	response.OK(c, gin.H{"ok": true, "tip": "开发环境验证码：" + code})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req phoneReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	user, err := h.findUserByPhone(c.Request.Context(), req.Phone)
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		response.Fail(c, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	h.respondLogin(c, user)
}

func (h *AuthHandler) LoginSMS(c *gin.Context) {
	var req phoneReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if !h.verifySMS(c.Request.Context(), req.Phone, "login", req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误")
		return
	}
	user, err := h.findUserByPhone(c.Request.Context(), req.Phone)
	if err != nil {
		// 验证码登录自动建号
		user, err = h.createUser(c.Request.Context(), req.Phone, req.CountryCode, "")
		if err != nil {
			response.Fail(c, http.StatusInternalServerError, "登录失败")
			return
		}
	}
	h.respondLogin(c, user)
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req phoneReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if !h.verifySMS(c.Request.Context(), req.Phone, "register", req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误")
		return
	}
	if _, err := h.findUserByPhone(c.Request.Context(), req.Phone); err == nil {
		response.Fail(c, http.StatusBadRequest, "手机号已注册")
		return
	}
	user, err := h.createUser(c.Request.Context(), req.Phone, req.CountryCode, req.Password)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "注册失败")
		return
	}
	h.respondLogin(c, user)
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req phoneReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if len(req.Password) < 6 {
		response.Fail(c, http.StatusBadRequest, "密码至少 6 位")
		return
	}
	if !h.verifySMS(c.Request.Context(), req.Phone, "reset", req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "重置失败")
		return
	}
	tag, err := h.DB.Exec(c.Request.Context(),
		`UPDATE users SET password_hash=$1, updated_at=NOW() WHERE phone=$2`,
		string(hash), req.Phone,
	)
	if err != nil || tag.RowsAffected() == 0 {
		response.Fail(c, http.StatusBadRequest, "用户不存在")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *AuthHandler) respondLogin(c *gin.Context, user models.User) {
	user.PasswordHash = ""
	token, err := middleware.IssueToken(h.Cfg.JWTSecret, user.ID, 7*24*time.Hour)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "签发令牌失败")
		return
	}
	response.OK(c, models.LoginResult{Token: token, User: user})
}

func (h *AuthHandler) findUserByPhone(ctx context.Context, phone string) (models.User, error) {
	var u models.User
	err := h.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at
		FROM users WHERE phone=$1`, phone,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

func (h *AuthHandler) createUser(ctx context.Context, phone, countryCode, password string) (models.User, error) {
	if countryCode == "" {
		countryCode = "+86"
	}
	hash := ""
	if password != "" {
		b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return models.User{}, err
		}
		hash = string(b)
	} else {
		b, _ := bcrypt.GenerateFromPassword([]byte("123456"), bcrypt.DefaultCost)
		hash = string(b)
	}
	nickname := "用户" + phone[max(0, len(phone)-4):]
	var count int
	_ = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	publicID := fmt.Sprintf("chat%d", 10000+count+1)
	var u models.User
	err := h.DB.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id)
		VALUES($1,$2,$3,$4,'',$5)
		RETURNING id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at`,
		phone, countryCode, hash, nickname, publicID,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	if err == nil {
		u.PasswordHash = ""
	}
	return u, err
}

func (h *AuthHandler) verifySMS(ctx context.Context, phone, scene, code string) bool {
	if code == "" {
		return false
	}
	if h.Cfg.DevSMSCode != "" && code == h.Cfg.DevSMSCode {
		return true
	}
	var id int64
	err := h.DB.QueryRow(ctx, `
		SELECT id FROM sms_codes
		WHERE phone=$1 AND scene=$2 AND code=$3 AND expires_at > NOW()
		ORDER BY id DESC LIMIT 1`, phone, scene, code,
	).Scan(&id)
	return err == nil
}

func randomDigits(n int) string {
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		v, _ := rand.Int(rand.Reader, big.NewInt(10))
		out[i] = byte('0' + v.Int64())
	}
	return string(out)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
