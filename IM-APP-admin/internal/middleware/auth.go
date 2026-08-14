package middleware

import (
	"net/http"
	"strings"
	"time"

	"im-app-admin/internal/response"
	"im-app-admin/internal/util"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const ContextAdminID = "adminId"

type Claims struct {
	AdminID string `json:"aid"`
	Scope   string `json:"scope,omitempty"` // 空=正式 token；mfa=二次验证挑战
	jwt.RegisteredClaims
}

// IssueAccessToken 签发管理员 access token（管理端独立 issuer/audience/密钥，清单 3.2）
// scope 为空=正式 token；传 ScopeMFA 表示仅用于二次验证的挑战 token
func IssueAccessToken(secret, issuer, audience, adminID string, ttl time.Duration) (string, error) {
	return issueToken(secret, issuer, audience, adminID, "", ttl)
}

// IssueScopeToken 签发带 scope 的挑战 token
func IssueScopeToken(secret, issuer, audience, adminID, scope string, ttl time.Duration) (string, error) {
	return issueToken(secret, issuer, audience, adminID, scope, ttl)
}

func issueToken(secret, issuer, audience, adminID, scope string, ttl time.Duration) (string, error) {
	claims := Claims{
		AdminID: adminID,
		Scope:   scope,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Audience:  jwt.ClaimStrings{audience},
			Subject:   adminID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        util.NewUUID(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// ValidateScopeToken 校验 scope token（用于 MFA 二次验证等）并返回管理员 ID
func ValidateScopeToken(secret, issuer, audience, tokenStr, scope string) (string, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	}, jwt.WithIssuer(issuer), jwt.WithAudience(audience), jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !token.Valid {
		return "", err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || claims.Scope != scope || claims.AdminID == "" {
		return "", jwt.ErrTokenInvalidClaims
	}
	return claims.AdminID, nil
}

// IssueRefreshToken 生成 refresh token 明文与哈希（明文只返回一次，库中只存哈希）
func IssueRefreshToken() (raw, hash string) {
	raw = util.RandomHex(32)
	return raw, util.SHA256Hex(raw)
}

// HashRefreshToken 对 refresh token 求哈希
func HashRefreshToken(raw string) string {
	return util.SHA256Hex(raw)
}

// AuthRequired 管理员登录态校验：验签 + issuer + audience
func AuthRequired(secret, issuer, audience string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if h == "" || !strings.HasPrefix(h, "Bearer ") {
			response.Unauthorized(c, "缺少登录凭证")
			c.Abort()
			return
		}
		raw := strings.TrimPrefix(h, "Bearer ")
		token, err := jwt.ParseWithClaims(raw, &Claims{}, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		}, jwt.WithIssuer(issuer), jwt.WithAudience(audience), jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !token.Valid {
			response.FailErr(c, http.StatusUnauthorized, "登录已过期或无效", err)
			c.Abort()
			return
		}
		claims, ok := token.Claims.(*Claims)
		if !ok || claims.AdminID == "" {
			response.Unauthorized(c, "登录凭证无效")
			c.Abort()
			return
		}
		c.Set(ContextAdminID, claims.AdminID)
		c.Next()
	}
}

// AdminID 从 context 取当前管理员 ID
func AdminID(c *gin.Context) string {
	v, _ := c.Get(ContextAdminID)
	s, _ := v.(string)
	return s
}
