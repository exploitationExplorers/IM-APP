package handler

import (
	"context"
	"crypto/subtle"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

const maxOpenIMWebhookBodyBytes = 64 << 10

type openIMWebhookMessage struct {
	CallbackCommand string   `json:"callbackCommand"`
	ServerMsgID     string   `json:"serverMsgID"`
	ClientMsgID     string   `json:"clientMsgID"`
	ConversationID  string   `json:"conversationID"`
	SendID          string   `json:"sendID"`
	UserID          string   `json:"userID"`
	RecvID          string   `json:"recvID"`
	GroupID         string   `json:"groupID"`
	ContentType     int      `json:"contentType"`
	Seq             int64    `json:"seq"`
	SendTime        int64    `json:"sendTime"`
	AtUserList      []string `json:"atUserList"`
}

type openIMWebhookResponse struct {
	ActionCode int    `json:"actionCode"`
	ErrCode    int    `json:"errCode"`
	ErrMsg     string `json:"errMsg"`
	ErrDlt     string `json:"errDlt"`
	NextCode   int    `json:"nextCode"`
}

type OpenIMWebhookHandler struct {
	Access    *repository.IMAccessRepo
	Client    *im.Client
	Secret    string
	AdminUser string
	AllowNets []*net.IPNet
	// Pusher 消息推送服务（日志桩或真实 APNs/FCM 通道），AfterMessage 回调时触发。
	Pusher service.PushService
}

func NewOpenIMWebhookHandler(access *repository.IMAccessRepo, client *im.Client, secret, adminUser string, allowCIDRs []string, pusher service.PushService) *OpenIMWebhookHandler {
	return &OpenIMWebhookHandler{
		Access: access, Client: client, Secret: strings.TrimSpace(secret), AdminUser: strings.TrimSpace(adminUser),
		AllowNets: parseAllowNets(allowCIDRs), Pusher: pusher,
	}
}

func (h *OpenIMWebhookHandler) BeforeSingle(c *gin.Context) {
	if !h.authorized(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	limitWebhookBody(c)
	var req openIMWebhookMessage
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, denyWebhook("invalid callback payload"))
		return
	}
	if req.SendID == h.AdminUser {
		c.JSON(http.StatusOK, allowWebhook())
		return
	}
	senderID, err := im.BusinessIDFromUserID(req.SendID)
	if err != nil {
		c.JSON(http.StatusOK, denyWebhook("invalid sender"))
		return
	}
	receiverID, err := im.BusinessIDFromUserID(req.RecvID)
	if err != nil {
		c.JSON(http.StatusOK, denyWebhook("invalid receiver"))
		return
	}
	peer, err := h.Access.ResolvePeer(c.Request.Context(), senderID, receiverID)
	if err != nil || !peer.CanChat {
		reason := peer.DenyReason
		if reason == "" {
			reason = "chat is not allowed"
		}
		c.JSON(http.StatusOK, denyWebhook(reason))
		return
	}
	c.JSON(http.StatusOK, allowWebhook())
}

func (h *OpenIMWebhookHandler) BeforeGroup(c *gin.Context) {
	if !h.authorized(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	limitWebhookBody(c)
	var req openIMWebhookMessage
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, denyWebhook("invalid callback payload"))
		return
	}
	if req.SendID == h.AdminUser {
		c.JSON(http.StatusOK, allowWebhook())
		return
	}
	senderID, err := im.BusinessIDFromUserID(req.SendID)
	if err != nil {
		c.JSON(http.StatusOK, denyWebhook("invalid sender"))
		return
	}
	groupID, err := im.BusinessIDFromUserID(req.GroupID)
	if err != nil {
		c.JSON(http.StatusOK, denyWebhook("invalid group"))
		return
	}
	group, err := h.Access.ResolveGroup(c.Request.Context(), senderID, groupID)
	if err != nil || !group.CanChat {
		reason := group.DenyReason
		if reason == "" {
			reason = "group chat is not allowed"
		}
		c.JSON(http.StatusOK, denyWebhook(reason))
		return
	}
	c.JSON(http.StatusOK, allowWebhook())
}

func (h *OpenIMWebhookHandler) AfterMessage(c *gin.Context) {
	if !h.authorized(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	limitWebhookBody(c)
	var req openIMWebhookMessage
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, denyWebhook("invalid callback payload"))
		return
	}
	senderID := req.SendID
	if senderID == "" {
		senderID = req.UserID
	}
	if err := h.Access.RecordMessageAudit(c.Request.Context(), req.CallbackCommand,
		req.ServerMsgID, req.ClientMsgID, req.ConversationID, senderID,
		req.RecvID, req.GroupID, req.ContentType, req.Seq, req.SendTime); err != nil {
		c.JSON(http.StatusInternalServerError, denyWebhook("audit storage failed"))
		return
	}
	// 触发消息推送（来消息提示）。推送解析（含群成员展开）异步进行，不阻塞 OpenIM 回调响应；
	// 即便推送失败也不影响消息投递与审计。
	if h.Pusher != nil {
		go h.dispatchPush(req, senderID)
	}
	c.JSON(http.StatusOK, allowWebhook())
}

// dispatchPush 在独立 goroutine 中解析推送收件人并下发。
//   - 单聊：收件人即 req.RecvID（排除发送方与管理员账号）。
//   - 群聊：展开群成员列表，排除发送方与管理员账号——之前此处收件人一直为空，
//     导致群消息无法经真实推送通道下发。
func (h *OpenIMWebhookHandler) dispatchPush(req openIMWebhookMessage, senderID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	recvs := make([]string, 0, 1)
	if req.GroupID == "" {
		if req.RecvID != "" && req.RecvID != h.AdminUser && req.RecvID != req.SendID {
			recvs = append(recvs, req.RecvID)
		}
	} else if h.Client != nil && h.Client.Available() {
		members, err := h.Client.ListGroupMemberIDs(ctx, req.GroupID)
		if err != nil {
			log.Printf("openim webhook: list group members failed: %v", err)
		} else {
			for _, m := range members {
				if m == req.SendID || m == h.AdminUser {
					continue
				}
				recvs = append(recvs, m)
			}
		}
	}
	_ = h.Pusher.Dispatch(ctx, service.PushMessage{
		ConversationID: req.ConversationID,
		SenderOpenIMID: req.SendID,
		RecvOpenIMIDs:  recvs,
		GroupID:        req.GroupID,
		ContentType:    req.ContentType,
		SendTime:       req.SendTime,
	})
}

func limitWebhookBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxOpenIMWebhookBodyBytes)
}

func (h *OpenIMWebhookHandler) authorized(c *gin.Context) bool {
	if h == nil || h.Access == nil || h.Secret == "" || len(h.AllowNets) == 0 {
		return false
	}
	provided := c.Param("secret")
	if len(provided) != len(h.Secret) || subtle.ConstantTimeCompare([]byte(provided), []byte(h.Secret)) != 1 {
		return false
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		host = c.Request.RemoteAddr
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	for _, network := range h.AllowNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func parseAllowNets(values []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if !strings.Contains(value, "/") {
			if ip := net.ParseIP(value); ip != nil {
				mask := net.CIDRMask(128, 128)
				if ip.To4() != nil {
					ip = ip.To4()
					mask = net.CIDRMask(32, 32)
				}
				networks = append(networks, &net.IPNet{IP: ip, Mask: mask})
				continue
			}
		}
		_, network, err := net.ParseCIDR(value)
		if err == nil {
			networks = append(networks, network)
		}
	}
	return networks
}

func allowWebhook() openIMWebhookResponse {
	return openIMWebhookResponse{ActionCode: 0, NextCode: 0}
}

func denyWebhook(reason string) openIMWebhookResponse {
	return openIMWebhookResponse{
		ActionCode: 0, ErrCode: 5001, ErrMsg: reason, ErrDlt: reason, NextCode: 1,
	}
}
