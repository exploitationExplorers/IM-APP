package handler

import (
	"strings"
	"time"

	"im-app-admin/internal/models"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== 消息发送记录与失败排查（读核心库，挂在 OpsHandler 上，复用既有装配） =====

// parseAdminTime 解析查询时间：支持 RFC3339 与 YYYY-MM-DD；无法解析返回 zero+false。
func parseAdminTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	if t, err := time.ParseInLocation("2006-01-02T15:04:05", s, time.Local); err == nil {
		return t, true
	}
	if t, err := time.ParseInLocation("2006-01-02", s, time.Local); err == nil {
		return t, true
	}
	return time.Time{}, false
}

// ListMessages GET /messages —— 成功消息记录，默认近 7 天避免全表扫描。
func (h *OpsHandler) ListMessages(c *gin.Context) {
	page, size := pageParams(c)
	f := models.MessageAuditFilter{
		ContentType:   atoi(c.Query("contentType"), 0),
		SenderKeyword: strings.TrimSpace(c.Query("senderKeyword")),
		PeerType:      c.Query("peerType"),
	}
	if from, ok := parseAdminTime(c.Query("from")); ok {
		f.From = from
	} else {
		f.From = time.Now().AddDate(0, 0, -7)
	}
	if to, ok := parseAdminTime(c.Query("to")); ok {
		f.To = to
	}
	list, total, err := h.Svc.ListMessages(c.Request.Context(), f, page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}

// ListMessageFailures GET /messages/failures —— 发送失败记录。
func (h *OpsHandler) ListMessageFailures(c *gin.Context) {
	page, size := pageParams(c)
	f := models.MessageFailureFilter{
		ContentType:   atoi(c.Query("contentType"), 0),
		FailCode:      strings.TrimSpace(c.Query("failCode")),
		SenderKeyword: strings.TrimSpace(c.Query("senderKeyword")),
		Source:        strings.TrimSpace(c.Query("source")),
	}
	if from, ok := parseAdminTime(c.Query("from")); ok {
		f.From = from
	}
	if to, ok := parseAdminTime(c.Query("to")); ok {
		f.To = to
	}
	list, total, err := h.Svc.ListMessageFailures(c.Request.Context(), f, page, size)
	if err != nil {
		response.FailErr(c, 500, "查询失败", err)
		return
	}
	response.OKPage(c, list, total, page, size)
}
