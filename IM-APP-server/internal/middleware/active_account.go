package middleware

import (
	"context"
	"github.com/gin-gonic/gin"
	"im-app-server/internal/response"
)

// 每次读取数据库，注销后的旧 access token 不可在有效期内继续访问业务接口。
func ActiveAccount(active func(context.Context, string) (bool, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, err := active(c.Request.Context(), UserID(c))
		if err != nil {
			response.Fail(c, 503, "暂时无法验证账号")
			c.Abort()
			return
		}
		if !ok {
			response.Unauthorized(c, "账号已注销或不可用，请重新登录")
			c.Abort()
			return
		}
		c.Next()
	}
}
