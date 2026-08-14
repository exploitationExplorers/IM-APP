package middleware

import (
	"net/http"
	"time"

	"im-app-server/internal/infra"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
)

// RateLimitIP 按客户端 IP 限流：每个 window 内最多 limit 次，超限返回 429
// Redis 不可用时自动放行（不阻断服务）
func RateLimitIP(redis *infra.Redis, limit int, window time.Duration, prefix string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if redis == nil || !redis.Available() {
			c.Next()
			return
		}
		if !redis.AllowIP(c.Request.Context(), prefix+":"+c.ClientIP(), limit, window) {
			response.Fail(c, http.StatusTooManyRequests, "请求过于频繁")
			c.Abort()
			return
		}
		c.Next()
	}
}
