package middleware

import (
	"strings"
	"time"

	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const ContextAdminID = "adminId"

type Claims struct {
	AdminID string `json:"aid"`
	jwt.RegisteredClaims
}

func IssueToken(secret, adminID string) (string, error) {
	claims := Claims{
		AdminID: adminID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(12 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// AuthRequired 管理员登录态校验
func AuthRequired(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if h == "" || !strings.HasPrefix(h, "Bearer ") {
			response.Fail(c, 401, "缺少登录凭证")
			c.Abort()
			return
		}
		raw := strings.TrimPrefix(h, "Bearer ")
		token, err := jwt.ParseWithClaims(raw, &Claims{}, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			response.Fail(c, 401, "登录已过期")
			c.Abort()
			return
		}
		claims := token.Claims.(*Claims)
		c.Set(ContextAdminID, claims.AdminID)
		c.Next()
	}
}

func AdminID(c *gin.Context) string {
	v, _ := c.Get(ContextAdminID)
	s, _ := v.(string)
	return s
}
