package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"im-app-server/internal/config"
	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	accessTokenTTL  = 2 * time.Hour
	refreshTokenTTL = 30 * 24 * time.Hour
	smsCodeTTL      = 10 * time.Minute
	smsMaxAttempts  = 5
)

type AuthHandler struct {
	DB    *pgxpool.Pool
	Cfg   config.Config
	Redis *infra.Redis
	SMS   service.SMSGateway
}

// ---- 短信验证码 ----

// SendSMS 发送短信验证码（scene: register|login|reset）
func (h *AuthHandler) SendSMS(c *gin.Context) {
	var req models.SendSMSRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Phone == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if req.Scene == "" {
		req.Scene = "login"
	}
	if !validSMSScene(req.Scene) {
		response.Fail(c, http.StatusBadRequest, "scene 不合法")
		return
	}
	e164, err := service.NormalizeE164(req.CountryCode, req.Phone)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "手机号格式不正确")
		return
	}
	ctx := c.Request.Context()

	// 限流：每分钟 1 条 / 每 IP 每小时 5 条 / 每号每日 10 条
	if h.Redis != nil && h.Redis.Available() {
		if !h.smsRateAllow(ctx, e164, c.ClientIP()) {
			response.Fail(c, http.StatusTooManyRequests, "发送过于频繁，请稍后再试")
			return
		}
	}

	code := h.Cfg.DevSMSCode
	if code == "" {
		code = randomDigits(6)
	}
	codeHash := hashHex(code)
	now := time.Now()
	if _, err := h.DB.Exec(ctx, `
		INSERT INTO sms_codes(phone, scene, code, code_hash, expires_at, created_at)
		VALUES($1,$2,$3,$4,$5,$6)`,
		e164, req.Scene, code, codeHash, now.Add(smsCodeTTL), now,
	); err != nil {
		response.Fail(c, http.StatusInternalServerError, "发送失败")
		return
	}
	_, _ = h.DB.Exec(ctx, `
		INSERT INTO sms_send_logs(phone_e164, country_code, scene, provider, device_id)
		VALUES($1,$2,$3,'aliyun',$4)`,
		e164, req.CountryCode, req.Scene, req.DeviceID,
	)
	// 真正发送短信（未配置阿里云短信时用 dev 网关，仅记日志）
	if h.SMS != nil {
		local := digitsOnly(req.Phone)
		if err := h.SMS.Send(ctx, local, req.CountryCode, code, req.Scene); err != nil {
			log.Printf("send sms failed: %v", err)
			response.Fail(c, http.StatusInternalServerError, "短信发送失败")
			return
		}
	}
	result := models.SendSMSResult{
		RetryAfterSec: 60,
		ExpiresIn:     int(smsCodeTTL.Seconds()),
	}
	if h.Cfg.DevSMSCode != "" {
		result.DevCode = code
	}
	response.OK(c, result)
}

// 一次消费验证码：校验哈希、错误次数上限、消费后不可复用
func (h *AuthHandler) verifySMSCode(ctx context.Context, e164, scene, code string) bool {
	if code == "" {
		return false
	}
	// 开发环境通配验证码
	if h.Cfg.DevSMSCode != "" && code == h.Cfg.DevSMSCode {
		return true
	}
	codeHash := hashHex(code)
	var id int64
	var attempts int
	err := h.DB.QueryRow(ctx, `
		SELECT id, attempts FROM sms_codes
		WHERE phone=$1 AND scene=$2 AND consumed_at IS NULL AND expires_at > NOW()
		ORDER BY id DESC LIMIT 1`, e164, scene,
	).Scan(&id, &attempts)
	if err != nil {
		return false
	}
	if attempts >= smsMaxAttempts {
		return false
	}
	var storedHash string
	_ = h.DB.QueryRow(ctx, `SELECT code_hash FROM sms_codes WHERE id=$1`, id).Scan(&storedHash)
	if storedHash != codeHash {
		_, _ = h.DB.Exec(ctx, `UPDATE sms_codes SET attempts = attempts + 1 WHERE id=$1`, id)
		return false
	}
	_, err = h.DB.Exec(ctx, `UPDATE sms_codes SET consumed_at = NOW() WHERE id=$1 AND consumed_at IS NULL`, id)
	return err == nil
}

// ---- 注册 ----

// Register 手机号+验证码+密码 注册
func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if len(req.Password) < 6 {
		response.Fail(c, http.StatusBadRequest, "密码至少 6 位")
		return
	}
	e164, err := service.NormalizeE164(req.CountryCode, req.Phone)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "手机号格式不正确")
		return
	}
	ctx := c.Request.Context()
	if !h.verifySMSCode(ctx, e164, "register", req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误或已失效")
		return
	}
	if _, err := h.findUserByE164(ctx, e164); err == nil {
		response.Fail(c, http.StatusConflict, "手机号已注册")
		return
	}
	u, err := h.createUser(ctx, e164, req.CountryCode, req.Password)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "注册失败")
		return
	}
	// 注册成功即生成唯一二维码（失败不阻塞注册，GET /me/qrcode 会兜底生成）
	qrRepo := &repository.UserRepo{DB: h.DB}
	if _, err := qrRepo.EnsureQRCode(ctx, u.ID); err != nil {
		log.Printf("generate qrcode failed: %v", err)
	}
	h.respondAuth(c, u, req.DeviceID)
}

// ---- 登录 ----

// Login 手机号+密码 登录
func (h *AuthHandler) Login(c *gin.Context) {
	var req models.PasswordLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	e164, err := service.NormalizeE164(req.CountryCode, req.Phone)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "手机号格式不正确")
		return
	}
	user, err := h.findUserByE164(c.Request.Context(), e164)
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		response.Fail(c, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	h.respondAuth(c, user, req.DeviceID)
}

// LoginSMS 手机号+验证码 登录（禁止未注册手机号静默注册）
func (h *AuthHandler) LoginSMS(c *gin.Context) {
	var req models.SMSLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	e164, err := service.NormalizeE164(req.CountryCode, req.Phone)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "手机号格式不正确")
		return
	}
	ctx := c.Request.Context()
	if !h.verifySMSCode(ctx, e164, "login", req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误或已失效")
		return
	}
	user, err := h.findUserByE164(ctx, e164)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "该手机号未注册，请先注册")
		return
	}
	h.respondAuth(c, user, req.DeviceID)
}

// ---- Token ----

// RefreshToken 用 refresh token 换取新 access+refresh（轮换）
func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req models.RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.RefreshToken == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	ctx := c.Request.Context()
	hash := hashHex(req.RefreshToken)

	var userID string
	var expiresAt time.Time
	var revokedAt *time.Time
	err := h.DB.QueryRow(ctx, `
		SELECT user_id::text, expires_at, revoked_at FROM auth_sessions
		WHERE refresh_token_hash=$1`, hash,
	).Scan(&userID, &expiresAt, &revokedAt)
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, "登录已过期，请重新登录")
		return
	}
	if revokedAt != nil || time.Now().After(expiresAt) {
		response.Fail(c, http.StatusUnauthorized, "登录已过期，请重新登录")
		return
	}
	user, err := h.findUserByID(ctx, userID)
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, "用户不存在")
		return
	}
	newRefresh, err := randomRefreshToken()
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "签发令牌失败")
		return
	}
	if _, err := h.DB.Exec(ctx, `
		UPDATE auth_sessions SET refresh_token_hash=$1, expires_at=$2
		WHERE refresh_token_hash=$3 AND revoked_at IS NULL`,
		hashHex(newRefresh), time.Now().Add(refreshTokenTTL), hash,
	); err != nil {
		response.Fail(c, http.StatusInternalServerError, "刷新失败")
		return
	}
	access, err := middleware.IssueToken(h.Cfg.JWTSecret, user.ID, accessTokenTTL)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "签发令牌失败")
		return
	}
	response.OK(c, models.TokenPair{
		AccessToken:  access,
		RefreshToken: newRefresh,
		ExpiresIn:    int(accessTokenTTL.Seconds()),
	})
}

// Logout 退出当前设备（撤销对应 session）
func (h *AuthHandler) Logout(c *gin.Context) {
	var req models.LogoutRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.RefreshToken == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if _, err := h.DB.Exec(c.Request.Context(),
		`UPDATE auth_sessions SET revoked_at=NOW() WHERE refresh_token_hash=$1 AND revoked_at IS NULL`,
		hashHex(req.RefreshToken)); err != nil {
		response.Fail(c, http.StatusInternalServerError, "退出失败")
		return
	}
	response.OK(c, models.Empty{OK: true})
}

// LogoutAll 退出全部设备（撤销该用户所有 session，需登录态）
func (h *AuthHandler) LogoutAll(c *gin.Context) {
	uid := middleware.UserID(c)
	if uid == "" {
		response.Unauthorized(c, "缺少登录凭证")
		return
	}
	if _, err := h.DB.Exec(c.Request.Context(),
		`UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL`,
		uid); err != nil {
		response.Fail(c, http.StatusInternalServerError, "退出失败")
		return
	}
	response.OK(c, models.Empty{OK: true})
}

// ---- 重置密码 ----

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req models.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if len(req.Password) < 6 {
		response.Fail(c, http.StatusBadRequest, "密码至少 6 位")
		return
	}
	e164, err := service.NormalizeE164(req.CountryCode, req.Phone)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "手机号格式不正确")
		return
	}
	ctx := c.Request.Context()
	if !h.verifySMSCode(ctx, e164, "reset", req.Code) {
		response.Fail(c, http.StatusBadRequest, "验证码错误或已失效")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "重置失败")
		return
	}
	tag, err := h.DB.Exec(ctx,
		`UPDATE users SET password_hash=$1, updated_at=NOW() WHERE phone_e164=$2 AND status='active'`,
		string(hash), e164,
	)
	if err != nil || tag.RowsAffected() == 0 {
		response.Fail(c, http.StatusBadRequest, "用户不存在")
		return
	}
	response.OK(c, models.Empty{OK: true})
}

// ---- 内部方法 ----

// respondAuth 签发 access+refresh 并创建 session
func (h *AuthHandler) respondAuth(c *gin.Context, user models.User, deviceID string) {
	user.PasswordHash = ""
	access, err := middleware.IssueToken(h.Cfg.JWTSecret, user.ID, accessTokenTTL)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "签发令牌失败")
		return
	}
	refresh, err := randomRefreshToken()
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "签发令牌失败")
		return
	}
	if _, err := h.DB.Exec(c.Request.Context(), `
		INSERT INTO auth_sessions(user_id, device_id, refresh_token_hash, ip, user_agent, expires_at)
		VALUES($1,$2,$3,$4,$5,$6)`,
		user.ID, deviceID, hashHex(refresh), c.ClientIP(), c.Request.UserAgent(), time.Now().Add(refreshTokenTTL),
	); err != nil {
		response.Fail(c, http.StatusInternalServerError, "签发令牌失败")
		return
	}
	response.OK(c, models.AuthResult{
		TokenPair: models.TokenPair{
			AccessToken:  access,
			RefreshToken: refresh,
			ExpiresIn:    int(accessTokenTTL.Seconds()),
		},
		User: toMeProfile(user),
	})
}

// smsRateAllow 多维度限流：每分钟 / IP 每小时 / 号码每日
func (h *AuthHandler) smsRateAllow(ctx context.Context, e164, ip string) bool {
	cli := h.Redis.Client
	minKey := "sms:rate:" + e164
	ok, err := cli.SetNX(ctx, minKey, "1", time.Minute).Result()
	if err != nil || !ok {
		return false
	}
	ipKey := "sms:ip:" + ip
	if cnt, err := cli.Incr(ctx, ipKey).Result(); err == nil {
		if cnt == 1 {
			cli.Expire(ctx, ipKey, time.Hour)
		}
		if cnt > 5 {
			return false
		}
	}
	dailyKey := "sms:daily:" + e164
	if cnt, err := cli.Incr(ctx, dailyKey).Result(); err == nil {
		if cnt == 1 {
			cli.Expire(ctx, dailyKey, 24*time.Hour)
		}
		if cnt > 10 {
			return false
		}
	}
	return true
}

func (h *AuthHandler) findUserByE164(ctx context.Context, e164 string) (models.User, error) {
	var u models.User
	err := h.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at
		FROM users WHERE phone_e164=$1 AND status='active'`, e164,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

func (h *AuthHandler) findUserByID(ctx context.Context, id string) (models.User, error) {
	var u models.User
	err := h.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at
		FROM users WHERE id=$1 AND status='active'`, id,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

// createUser 创建用户：phone 存本地号码，phone_e164 存标准 E.164
func (h *AuthHandler) createUser(ctx context.Context, e164, countryCode, password string) (models.User, error) {
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
	dial := digitsOnly(countryCode)
	if dial == "" {
		dial = "86"
	}
	cc := "+" + dial
	local := strings.TrimPrefix(strings.TrimPrefix(e164, "+"), dial)
	nickname := "用户" + local[max(0, len(local)-4):]
	var count int
	_ = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	publicID := fmt.Sprintf("chat%d", 10000+count+1)

	var u models.User
	err := h.DB.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, phone_e164, password_hash, nickname, avatar, public_id)
		VALUES($1,$2,$3,$4,$5,$7,$6)
		RETURNING id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at`,
		local, cc, e164, hash, nickname, publicID, models.DefaultAvatar,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	if err == nil {
		u.PasswordHash = ""
	}
	return u, err
}

func toMeProfile(u models.User) models.MeProfile {
	return models.MeProfile{
		ID:          u.ID,
		PhoneMasked: service.MaskPhone(u.Phone),
		CountryCode: u.CountryCode,
		PublicID:    u.PublicID,
		Nickname:    u.Nickname,
		Avatar:      u.Avatar,
		Bio:         u.Bio,
		Status:      u.Status,
		CreatedAt:   u.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func validSMSScene(s string) bool {
	switch s {
	case "register", "login", "reset":
		return true
	}
	return false
}

func hashHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func randomRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func randomDigits(n int) string {
	out := make([]byte, n)
	for i := range n {
		v, _ := rand.Int(rand.Reader, big.NewInt(10))
		out[i] = byte('0' + v.Int64())
	}
	return string(out)
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
