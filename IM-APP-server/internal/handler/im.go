package handler

import (
	"errors"
	"io"
	"log"
	"net/http"

	"im-app-server/internal/im"
	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type IMHandler struct {
	Service *service.IMService
}

type imTokenRequest struct {
	PlatformID int `json:"platformId"`
}

// Token keeps the original API contract. User creation/synchronization is a
// backend concern and never requires another call from the client.
func (h *IMHandler) Token(c *gin.Context) {
	var req imTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		response.Fail(c, http.StatusBadRequest, "platformId 不正确")
		return
	}
	// Preserve the original uni-app default.
	if req.PlatformID == 0 {
		req.PlatformID = 5
	}
	result, err := h.Service.Token(c.Request.Context(), middleware.UserID(c), req.PlatformID)
	if err != nil {
		switch {
		case errors.Is(err, im.ErrInvalidPlatform):
			response.Fail(c, http.StatusBadRequest, "platformId 不正确")
		case errors.Is(err, service.ErrIMAccountInactive):
			response.Fail(c, http.StatusForbidden, "账号不可用")
		case errors.Is(err, service.ErrIMUnavailable), errors.Is(err, im.ErrUnavailable):
			response.Fail(c, http.StatusServiceUnavailable, "OpenIM 服务不可用")
		default:
			response.Fail(c, http.StatusBadGateway, "获取 IM Token 失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *IMHandler) Peer(c *gin.Context) {
	peer, err := h.Service.ResolvePeer(c.Request.Context(), middleware.UserID(c), c.Param("businessUserId"))
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrIMTargetNotFound), errors.Is(err, im.ErrInvalidUserID):
			response.Fail(c, http.StatusNotFound, "聊天用户不存在")
		default:
			response.Fail(c, http.StatusInternalServerError, "解析聊天用户失败")
		}
		return
	}
	response.OK(c, peer)
}

func (h *IMHandler) Group(c *gin.Context) {
	groupID := c.Param("businessGroupId")
	group, err := h.Service.ResolveGroup(c.Request.Context(), middleware.UserID(c), groupID)
	if err != nil {
		log.Printf("resolve group %s: %v", groupID, err)
		switch {
		case errors.Is(err, repository.ErrIMTargetNotFound), errors.Is(err, im.ErrInvalidUserID):
			response.Fail(c, http.StatusNotFound, "群聊不存在或无权访问")
		default:
			response.Fail(c, http.StatusInternalServerError, "解析群聊失败")
		}
		return
	}
	response.OK(c, group)
}

// GroupByIM 接收 OpenIM 群 ID（会话列表拿到的 groupID），反查业务群资料。
func (h *IMHandler) GroupByIM(c *gin.Context) {
	group, err := h.Service.ResolveGroupByIM(c.Request.Context(), middleware.UserID(c), c.Param("imGroupId"))
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrIMTargetNotFound), errors.Is(err, im.ErrInvalidUserID):
			response.Fail(c, http.StatusNotFound, "群聊不存在或无权访问")
		default:
			response.Fail(c, http.StatusInternalServerError, "解析群聊失败")
		}
		return
	}
	response.OK(c, group)
}

// conversationPatchRequest 对应 PATCH 会话设置的部分更新入参。
// 用指针区分「未传」与「传了零值」：客户端没给的字段保持 nil，仅叠加给了的字段。
type conversationPatchRequest struct {
	RecvMsgOpt      *int    `json:"recvMsgOpt"`
	IsPinned        *bool   `json:"isPinned"`
	IsPrivateChat   *bool   `json:"isPrivateChat"`
	BurnDuration    *int64  `json:"burnDuration"`
	IsMsgDestruct   *bool   `json:"isMsgDestruct"`
	MsgDestructTime *int64  `json:"msgDestructTime"`
	GroupAtType     *int    `json:"groupAtType"`
	Ex              *string `json:"ex"`
	DraftText       *string `json:"draftText"`
}

type clearConversationMessagesRequest struct {
	PeerType string `json:"peerType"`
	PeerID   string `json:"peerId"`
}

// GetConversation 返回指定会话的当前设置（免打扰/置顶/阅后即焚等）。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
func (h *IMHandler) GetConversation(c *gin.Context) {
	peerType, peerId, ok := h.parsePeer(c)
	if !ok {
		return
	}
	settings, err := h.Service.GetConversationSettings(c.Request.Context(), middleware.UserID(c), peerType, peerId)
	if err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, settings)
}

// UpdateConversation 部分更新会话设置。至少要传一个配置字段，否则 400。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
func (h *IMHandler) UpdateConversation(c *gin.Context) {
	peerType, peerId, ok := h.parsePeer(c)
	if !ok {
		return
	}
	var req conversationPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	patch := service.ConversationPatch{
		RecvMsgOpt:      req.RecvMsgOpt,
		IsPinned:        req.IsPinned,
		IsPrivateChat:   req.IsPrivateChat,
		BurnDuration:    req.BurnDuration,
		IsMsgDestruct:   req.IsMsgDestruct,
		MsgDestructTime: req.MsgDestructTime,
		GroupAtType:     req.GroupAtType,
		Ex:              req.Ex,
		DraftText:       req.DraftText,
	}
	// 没有任何字段被传入：避免无意义的 GET/SET 往返。
	if patch.RecvMsgOpt == nil && patch.IsPinned == nil && patch.IsPrivateChat == nil &&
		patch.BurnDuration == nil && patch.IsMsgDestruct == nil && patch.MsgDestructTime == nil &&
		patch.GroupAtType == nil && patch.Ex == nil && patch.DraftText == nil {
		response.Fail(c, http.StatusBadRequest, "至少需要传入一个配置字段")
		return
	}
	settings, err := h.Service.UpdateConversationSettings(c.Request.Context(), middleware.UserID(c), peerType, peerId, patch)
	if err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, settings)
}

// MarkConversationRead 标记会话已读，清空未读计数。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
func (h *IMHandler) MarkConversationRead(c *gin.Context) {
	peerType, peerId, ok := h.parsePeer(c)
	if !ok {
		return
	}
	if err := h.Service.MarkConversationRead(c.Request.Context(), middleware.UserID(c), peerType, peerId); err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// ClearConversationMessages 清除当前用户在指定单聊或群聊中的全部历史消息。
// 该操作只影响当前用户及其其他登录设备，不删除对方或其他群成员的消息。
func (h *IMHandler) ClearConversationMessages(c *gin.Context) {
	var req clearConversationMessagesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if req.PeerType != "c2c" && req.PeerType != "group" {
		response.Fail(c, http.StatusBadRequest, "peerType 必须为 c2c 或 group")
		return
	}
	if req.PeerID == "" {
		response.Fail(c, http.StatusBadRequest, "peerId 不能为空")
		return
	}
	if err := h.Service.ClearConversationMessages(c.Request.Context(), middleware.UserID(c), req.PeerType, req.PeerID); err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, gin.H{"ok": true, "scope": "self"})
}

func (h *IMHandler) RecallMessage(c *gin.Context) {
	var req models.RecallMessageRequest
	if err := bindBusinessJSON(c, &req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	result, err := h.Service.RecallMessage(c.Request.Context(), middleware.UserID(c), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrIMInvalidRecallRequest):
			response.Fail(c, http.StatusBadRequest, "撤回参数错误")
		case errors.Is(err, service.ErrIMUnsupportedMessage):
			response.Fail(c, http.StatusBadRequest, "该消息类型不允许撤回")
		case errors.Is(err, service.ErrIMRecallForbidden):
			response.Fail(c, http.StatusForbidden, "无权撤回该消息")
		case errors.Is(err, service.ErrIMMessageNotFound):
			response.Fail(c, http.StatusNotFound, "消息不存在或消息标识不匹配")
		case errors.Is(err, service.ErrIMRecallExpired):
			response.Fail(c, http.StatusConflict, "消息已超过撤回时间")
		case errors.Is(err, service.ErrIMRecallConflict):
			response.Fail(c, http.StatusConflict, "该消息正在撤回，请稍后重试")
		case errors.Is(err, service.ErrIMUnavailable), errors.Is(err, im.ErrUnavailable):
			response.Fail(c, http.StatusServiceUnavailable, "OpenIM 服务不可用")
		case errors.Is(err, service.ErrIMRecallUpstream):
			response.Fail(c, http.StatusBadGateway, "OpenIM 撤回失败")
		default:
			response.Fail(c, http.StatusInternalServerError, "消息撤回处理失败")
		}
		return
	}
	response.OK(c, result)
}

// MessageReadStatus 查询发送者自己的群消息的已读状态（已读人数 / 已读成员）。
func (h *IMHandler) MessageReadStatus(c *gin.Context) {
	var req struct {
		ConversationID string                     `json:"conversationID"`
		Messages       []service.MessageReadQuery `json:"messages"`
	}
	if err := bindBusinessJSON(c, &req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	results, err := h.Service.MessageReadStatus(c.Request.Context(), middleware.UserID(c), req.ConversationID, req.Messages)
	if err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, results)
}

// parsePeer 从路径参数解析 peerType/peerId，并校验 peerType 合法性。
// 校验失败已直接写响应，调用方见返回值 ok=false 即可返回。
func (h *IMHandler) parsePeer(c *gin.Context) (string, string, bool) {
	peerType := c.Param("peerType")
	peerId := c.Param("peerId")
	if peerType != "c2c" && peerType != "group" {
		response.Fail(c, http.StatusBadRequest, "peerType 必须为 c2c 或 group")
		return "", "", false
	}
	if peerId == "" {
		response.Fail(c, http.StatusBadRequest, "peerId 不能为空")
		return "", "", false
	}
	return peerType, peerId, true
}

// SetGlobalMsgRecvOpt 设置用户级全局免打扰（对所有会话生效）。
func (h *IMHandler) SetGlobalMsgRecvOpt(c *gin.Context) {
	var req struct {
		RecvMsgOpt int `json:"recvMsgOpt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := h.Service.SetGlobalMsgRecvOpt(c.Request.Context(), middleware.UserID(c), req.RecvMsgOpt); err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, gin.H{"recvMsgOpt": req.RecvMsgOpt})
}

// pushTokenRequest 是注册设备推送凭证的入参。
type pushTokenRequest struct {
	Platform    string `json:"platform"`    // ios / android / web / harmony（必填）
	Channel     string `json:"channel"`     // apns / fcm / jpush / harmony（可选，web 可空）
	DeviceToken string `json:"deviceToken"` // 设备推送令牌（必填）
	Enabled     *bool  `json:"enabled"`     // 指针：区分「未传」与「显式 false」；缺省视为 true
}

// RegisterPushToken 注册/更新当前用户的设备推送凭证（来消息提示）。
// 按 Platform+DeviceToken 去重 upsert；Redis 不可用时返回 503。
func (h *IMHandler) RegisterPushToken(c *gin.Context) {
	var req pushTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.Platform == "" || req.DeviceToken == "" {
		response.Fail(c, http.StatusBadRequest, "platform 与 deviceToken 必填")
		return
	}
	token := service.PushToken{
		Platform:    req.Platform,
		Channel:     req.Channel,
		DeviceToken: req.DeviceToken,
		Enabled:     enabled,
	}
	if err := h.Service.RegisterPushToken(c.Request.Context(), middleware.UserID(c), token); err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// UnregisterPushToken 注销当前用户某个设备的推送凭证（退出登录/关闭推送时调用）。
func (h *IMHandler) UnregisterPushToken(c *gin.Context) {
	var req struct {
		DeviceToken string `json:"deviceToken"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		response.Fail(c, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if req.DeviceToken == "" {
		response.Fail(c, http.StatusBadRequest, "deviceToken 必填")
		return
	}
	if err := h.Service.UnregisterPushToken(c.Request.Context(), middleware.UserID(c), req.DeviceToken); err != nil {
		h.handleIMError(c, err)
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// handleIMError 把后端/OpenIM 错误统一映射为 HTTP 响应。
func (h *IMHandler) handleIMError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrIMInvalidRecvMsgOpt):
		response.Fail(c, http.StatusBadRequest, "recvMsgOpt 非法，只能为 0/1/2")
	case errors.Is(err, service.ErrIMInvalidPushPlatform):
		response.Fail(c, http.StatusBadRequest, "platform 非法，只能为 ios/android/web/harmony")
	case errors.Is(err, service.ErrIMInvalidPeerType):
		response.Fail(c, http.StatusBadRequest, "peerType 必须为 c2c 或 group")
	case errors.Is(err, service.ErrIMConversationNotFound):
		response.Fail(c, http.StatusNotFound, "会话不存在")
	case errors.Is(err, service.ErrIMTargetNotChattable):
		response.Fail(c, http.StatusForbidden, "与该好友/群不能聊天")
	case errors.Is(err, service.ErrIMInvalidReadStatusRequest):
		response.Fail(c, http.StatusBadRequest, "已读状态查询参数不正确")
	case errors.Is(err, service.ErrIMNotGroupMember):
		response.Fail(c, http.StatusForbidden, "你不是该群成员")
	case errors.Is(err, service.ErrIMUnavailable), errors.Is(err, im.ErrUnavailable):
		response.Fail(c, http.StatusServiceUnavailable, "OpenIM 服务不可用")
	default:
		response.Fail(c, http.StatusBadGateway, "OpenIM 操作失败")
	}
}
