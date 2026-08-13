package middleware

import (
	"net/http"
	"strings"

	"im-app-admin/internal/config"
	"im-app-admin/internal/response"
	"im-app-admin/internal/util"

	"github.com/gin-gonic/gin"
)

// RequestID 生成/透传请求 ID，写入 context 与响应头
func RequestID(cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader(cfg.RequestIDHeader)
		if rid == "" {
			rid = util.NewUUID()
		}
		c.Set(response.RequestIDKey, rid)
		c.Header(cfg.RequestIDHeader, rid)
		c.Next()
	}
}

// SecurityHeaders 安全响应头
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Content-Security-Policy", "default-src 'self'")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

// CORS 白名单 CORS（清单 00.1：严格 CORS）
// 本地 localhost 来源一律放行（开发友好）；显式白名单优先；
// 其他来源不带 CORS 头放行（浏览器按同源策略拦截跨域读取，服务端不主动 403，避免误伤 vite 代理等场景）
func CORS(origins []string) gin.HandlerFunc {
	allowAll := false
	allowMap := make(map[string]bool, len(origins)+8)
	for _, o := range origins {
		if o == "*" {
			allowAll = true // 配置 ADMIN_CORS_ORIGINS=* 时放行所有来源
		}
		allowMap[o] = true
	}
	// 本地开发常用来源默认放行
	for _, dev := range []string{
		"http://localhost:5180", "http://127.0.0.1:5180",
		"http://localhost:8090", "http://127.0.0.1:8090",
		"http://localhost:5173", "http://127.0.0.1:5173",
	} {
		allowMap[dev] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && (allowAll || allowMap[origin] || isLocalhostOrigin(origin)) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Max-Age", "600")
		}
		// 非放行来源：不写 CORS 头，浏览器会拦截跨域读取
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// isLocalhostOrigin 判断 Origin 是否为 localhost/127.0.0.1 的任意端口
func isLocalhostOrigin(origin string) bool {
	for _, p := range []string{
		"http://localhost:", "https://localhost:",
		"http://127.0.0.1:", "https://127.0.0.1:",
	} {
		if strings.HasPrefix(origin, p) {
			return true
		}
	}
	return false
}

// BodyLimit 请求体大小限制（清单 00.1）
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}

// ClientIP 获取真实客户端 IP（考虑可信代理）
func ClientIP(c *gin.Context) string {
	ip := c.ClientIP()
	if ip == "::1" {
		return "127.0.0.1"
	}
	return strings.TrimSpace(ip)
}
