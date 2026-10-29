package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// BeforeFriendMutation 阻止客户端绕过业务端的来源、频率和隐私校验。
// 业务端确认关系后使用管理员 import_friend 同步，不经过这两个申请/同意回调。
func (h *OpenIMWebhookHandler) BeforeFriendMutation(c *gin.Context) {
	if !h.authorized(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, denyWebhook("请通过应用内好友申请操作"))
}
