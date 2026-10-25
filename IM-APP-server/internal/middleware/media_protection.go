package middleware

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
)

type MediaProtector interface {
	Hold(context.Context, string) error
}

// Install after authentication. Do not consume multipart files, log bodies or
// alter casing/JSON bytes used by App native bridges and signature validation.
func ProtectMedia(p MediaProtector) gin.HandlerFunc {
	return func(c *gin.Context) {
		kind, _, _ := mime.ParseMediaType(c.GetHeader("Content-Type"))
		write := c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPut || c.Request.Method == http.MethodPatch
		if p == nil || !write || kind != "application/json" {
			c.Next()
			return
		}
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, (4<<20)+1))
		if err != nil || len(body) > 4<<20 {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"code": 413, "message": "请求内容过大"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		if p.Hold(c.Request.Context(), string(body)) != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": 503, "message": "媒体引用保护暂不可用，请稍后重试"})
			return
		}
		c.Next()
	}
}
