package middleware

import "github.com/gin-gonic/gin"

// NoStore 禁止中间层缓存带登录态的 API 响应（App WebView/CDN 可能错误缓存 GET）。
func NoStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store, no-cache, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		c.Next()
	}
}
