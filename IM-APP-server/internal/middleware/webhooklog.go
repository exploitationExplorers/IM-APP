package middleware

import (
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// webhookSlowThreshold 超过这个耗时就记一条日志。
//
// OpenIM 对 beforeSend* 回调的预算是 5 秒，且 failedContinue=false：
// 超时会被当成「回调失败」，消息直接拒发。所以 1 秒以上就值得记下来。
const webhookSlowThreshold = time.Second

// WebhookLog 记录 OpenIM 回调的耗时与异常状态码。
//
// 为什么单独做一条：这些路径形如
//
//	/internal/openim/webhooks/<secret>/callbackBeforeSendSingleMsgCommand
//
// 直接交给 gin 的访问日志会把密钥写进日志文件，所以 main.go 里用 SkipPaths
// 把它们整体排除了。代价是 webhook 完全不可观测——排查「消息为什么发不出去」
// 时在 docker logs 里翻不到任何回调记录，很容易误判成「回调根本没发生」。
//
// 这里补一条脱敏日志：密钥段替换成 ***，只记方法、状态码、耗时。
//
// 只记「非 200」和「慢于 webhookSlowThreshold」两种，避免每条消息都刷一行
// （正常情况下每条消息都会触发 2 次回调）。注意：
//   - 业务拒绝（非好友/拉黑/禁言等）走的是 HTTP 200 + nextCode=1，
//     状态码上看不出来，它们的可观测性在 im_message_send_failures 表里
//     （source=before_hook）。
//   - 这条日志负责的是另一类问题：回调超时、5xx、连接层故障。
func WebhookLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		elapsed := time.Since(start)

		status := c.Writer.Status()
		if status == 200 && elapsed < webhookSlowThreshold {
			return
		}
		log.Printf("[webhook] %s %s status=%d 耗时=%s",
			c.Request.Method, SanitizeWebhookPath(c.Request.URL.Path), status, elapsed.Round(time.Millisecond))
	}
}

// SanitizeWebhookPath 把路径里的密钥段替换成 ***，供日志输出使用。
// 形如 /internal/openim/webhooks/<secret>/callbackXxx → /internal/openim/webhooks/***/callbackXxx
func SanitizeWebhookPath(path string) string {
	const prefix = "/internal/openim/webhooks/"
	if !strings.HasPrefix(path, prefix) {
		return path
	}
	rest := path[len(prefix):]
	if i := strings.Index(rest, "/"); i >= 0 {
		return prefix + "***" + rest[i:]
	}
	return prefix + "***"
}
