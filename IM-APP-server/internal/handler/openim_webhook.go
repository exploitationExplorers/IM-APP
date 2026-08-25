package handler

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/infra"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

const maxOpenIMWebhookBodyBytes = 64 << 10

// OpenIM contentType：与 SDK MessageType 对齐
const (
	openIMContentPicture = 102
	openIMContentAtText  = 106
	openIMContentCard    = 108
)

// OpenIM @所有人 占位 userID
const openIMAtAllTag = "AtAllTag"

// 普通成员群内发图：每分钟最多 10 张；群主/管理员不限
const groupMemberImageLimitPerMin = 10

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
	Access       *service.IMWebhookAccess
	Audit        *repository.IMAccessRepo
	Client       *im.Client
	Restrictions *repository.RestrictionRepo
	Redis        *infra.Redis
	Secret       string
	AdminUser    string
	AllowNets    []*net.IPNet
	// Pusher 消息推送服务（日志桩或真实 APNs/FCM 通道），AfterMessage 回调时触发。
	Pusher service.PushService
}

func NewOpenIMWebhookHandler(
	access *repository.IMAccessRepo,
	webhookAccess *service.IMWebhookAccess,
	client *im.Client,
	restrictions *repository.RestrictionRepo,
	rdb *infra.Redis,
	secret, adminUser string,
	allowCIDRs []string,
	pusher service.PushService,
) *OpenIMWebhookHandler {
	return &OpenIMWebhookHandler{
		Access: webhookAccess, Audit: access, Client: client, Restrictions: restrictions, Redis: rdb,
		Secret: strings.TrimSpace(secret), AdminUser: strings.TrimSpace(adminUser),
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
		h.recordBeforeHookFailure(c.Request.Context(), req, "c2c", senderID, receiverID, reason)
		c.JSON(http.StatusOK, denyWebhook(reason))
		return
	}
	if h.checkMessageRestriction(c, req, "c2c", senderID, receiverID) {
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
		h.recordBeforeHookFailure(c.Request.Context(), req, "group", senderID, groupID, reason)
		c.JSON(http.StatusOK, denyWebhook(reason))
		return
	}
	if h.checkMessageRestriction(c, req, "group", senderID, groupID) {
		return
	}
	if reason := h.checkGroupMessagePolicy(c.Request.Context(), req, group.Role, senderID, groupID); reason != "" {
		h.recordBeforeHookFailure(c.Request.Context(), req, "group", senderID, groupID, reason)
		c.JSON(http.StatusOK, denyWebhook(reason))
		return
	}
	c.JSON(http.StatusOK, allowWebhook())
}

// checkGroupMessagePolicy 群聊消息策略：禁名片、普通成员发图限流、仅管理员 @所有人
func (h *OpenIMWebhookHandler) checkGroupMessagePolicy(
	ctx context.Context, req openIMWebhookMessage, role, senderID, groupID string,
) string {
	isManager := role == "owner" || role == "admin"
	switch req.ContentType {
	case openIMContentCard:
		return "群内不可分享个人名片"
	case openIMContentPicture:
		if isManager {
			return ""
		}
		if h.Redis != nil && !h.Redis.AllowIP(ctx, fmt.Sprintf("groupimg:%s:%s", senderID, groupID), groupMemberImageLimitPerMin, time.Minute) {
			return "普通成员每分钟最多发送10张图片"
		}
	case openIMContentAtText:
		if containsAtAll(req.AtUserList) && !isManager {
			return "仅群主或管理员可以@所有人"
		}
	}
	return ""
}

func containsAtAll(ids []string) bool {
	for _, id := range ids {
		if strings.EqualFold(strings.TrimSpace(id), openIMAtAllTag) {
			return true
		}
	}
	return false
}

// recordBeforeHookFailure best-effort 记录一条 beforeSend 拒绝的失败记录。
// 写库失败仅记日志、绝不阻断回调响应（拒绝语义已由 denyWebhook 保证）。
func (h *OpenIMWebhookHandler) recordBeforeHookFailure(ctx context.Context, req openIMWebhookMessage, peerType, senderID, targetID, reason string) {
	if h.Audit == nil {
		return
	}
	targetIMID := req.RecvID
	if peerType == "group" {
		targetIMID = req.GroupID
	}
	if err := h.Audit.RecordSendFailure(ctx, repository.SendFailureRecord{
		ClientMsgID: req.ClientMsgID,
		Source:      "before_hook",
		SenderID:    senderID,
		SenderIMID:  req.SendID,
		PeerType:    peerType,
		TargetID:    targetID,
		TargetIMID:  targetIMID,
		ContentType: req.ContentType,
		Stage:       "blocked",
		FailCode:    reason,
		FailMessage: reason,
	}); err != nil {
		log.Printf("openim webhook: record before-hook failure failed: %v", err)
	}
}

// checkMessageRestriction 检查发送者是否被管理端限制发消息（message 限制；命中则落库 + deny 并返回 true）
func (h *OpenIMWebhookHandler) checkMessageRestriction(c *gin.Context, req openIMWebhookMessage, peerType, senderID, targetID string) bool {
	if h.Restrictions == nil {
		return false
	}
	_, _, messageBanned, err := h.Restrictions.UserRestrictions(c.Request.Context(), senderID)
	if err == nil && messageBanned {
		reason := "message restricted by admin"
		h.recordBeforeHookFailure(c.Request.Context(), req, peerType, senderID, targetID, reason)
		c.JSON(http.StatusOK, denyWebhook(reason))
		return true
	}
	return false
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
	// OpenIM 3.8 的 afterSend 回调不携带 conversationID，需要按同一套规则补齐，
	// 否则审计表 conversation_id 为空，撤回时无法匹配。
	conversationID := req.ConversationID
	if conversationID == "" {
		conversationID = h.resolveAuditConversationID(c.Request.Context(), senderID, req.RecvID, req.GroupID)
	}
	if err := h.Audit.RecordMessageAudit(c.Request.Context(), req.CallbackCommand,
		req.ServerMsgID, req.ClientMsgID, conversationID, senderID,
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

// AfterDismissGroup 群解散回调：OpenIM 已经原生给所有成员推系统通知（contentType 1511 Dismissed），
// 前端 chatStore 会通过 OnRecvNewMessage 收到并渲染成「群主 解散了群聊」居中提示，
// 同时 room.vue 通过 watch 这个通知触发自动返回。这里保留 handler 是为了让
// OpenIM webhook URL 有个 200 响应，避免日志噪音。
func (h *OpenIMWebhookHandler) AfterDismissGroup(c *gin.Context) {
	if !h.authorized(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	limitWebhookBody(c)
	c.JSON(http.StatusOK, allowWebhook())
}

// resolveAuditConversationID 在回调未携带 conversationID 时按 OpenIM 规则补齐，
// 与撤回侧 buildC2CConversationID / resolveGroupConversationID 保持一致，保证能对上。
func (h *OpenIMWebhookHandler) resolveAuditConversationID(ctx context.Context, senderID, recvID, groupID string) string {
	if groupID != "" {
		if h.Client != nil {
			for _, cid := range []string{"sg_" + groupID, "g_" + groupID} {
				if list, err := h.Client.GetConversations(ctx, senderID, []string{cid}); err == nil && len(list) > 0 {
					return cid
				}
			}
		}
		return "sg_" + groupID
	}
	if recvID != "" {
		ids := []string{senderID, recvID}
		sort.Strings(ids)
		return "si_" + strings.Join(ids, "_")
	}
	return ""
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
	if h == nil || h.Audit == nil || h.Access == nil || h.Secret == "" || len(h.AllowNets) == 0 {
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
