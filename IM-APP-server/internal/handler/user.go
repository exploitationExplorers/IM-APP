package handler

import (
	"errors"
	"net/http"

	"im-app-server/internal/middleware"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type UserHandler struct {
	Svc *service.UserService
}

type updateProfileReq struct {
	Nickname     *string `json:"nickname"`
	AvatarFileID *string `json:"avatarFileId"`
	Bio          *string `json:"bio"`
}

func (h *UserHandler) Profile(c *gin.Context) {
	uid := middleware.UserID(c)
	u, err := h.Svc.GetProfile(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "用户不存在")
		return
	}
	response.OK(c, toMeProfile(u))
}

func (h *UserHandler) UpdateProfile(c *gin.Context) {
	uid := middleware.UserID(c)
	var req updateProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	u, err := h.Svc.UpdateProfile(c.Request.Context(), uid, req.Nickname, req.AvatarFileID, req.Bio)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, toMeProfile(u))
}

func (h *UserHandler) Qrcode(c *gin.Context) {
	uid := middleware.UserID(c)
	payload, err := h.Svc.Qrcode(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "用户不存在")
		return
	}
	response.OK(c, payload)
}

func (h *UserHandler) Search(c *gin.Context) {
	uid := middleware.UserID(c)
	publicID := c.Query("publicId")
	if publicID == "" {
		response.Fail(c, http.StatusBadRequest, "请输入公开 ID")
		return
	}
	u, err := h.Svc.SearchByPublicID(c.Request.Context(), uid, publicID)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, u)
}

func (h *UserHandler) GetUser(c *gin.Context) {
	userID := c.Param("id")
	u, err := h.Svc.GetPublicProfile(c.Request.Context(), userID)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "用户不存在")
		return
	}
	response.OK(c, u)
}

type ContactHandler struct {
	Svc *service.ContactService
}

func (h *ContactHandler) ListContacts(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListContacts(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *ContactHandler) ListGroups(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListGroups(c.Request.Context(), uid)
	if err != nil {
		response.OK(c, []interface{}{})
		return
	}
	response.OK(c, list)
}

func (h *ContactHandler) ListFriendRequests(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListFriendRequests(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

type friendRequestReq struct {
	ToUserID string `json:"toUserId"`
	Message  string `json:"message"`
}

func (h *ContactHandler) CreateFriendRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	var req friendRequestReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ToUserID == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	id, err := h.Svc.SendFriendRequest(c.Request.Context(), uid, req.ToUserID, req.Message)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrSelfAction):
			response.Fail(c, http.StatusBadRequest, "不能添加自己")
		case errors.Is(err, service.ErrAlreadyFriend):
			response.Fail(c, http.StatusBadRequest, "已经是好友")
		case errors.Is(err, service.ErrNotFound):
			response.Fail(c, http.StatusNotFound, "用户不存在")
		case errors.Is(err, service.ErrForbidden):
			response.Fail(c, http.StatusForbidden, "无法发送好友申请")
		default:
			response.Fail(c, http.StatusInternalServerError, "发送失败")
		}
		return
	}
	response.OK(c, gin.H{"ok": true, "id": id})
}

func (h *ContactHandler) AcceptFriendRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.AcceptFriendRequest(c.Request.Context(), uid, c.Param("id")); err != nil {
		response.Fail(c, http.StatusBadRequest, "申请不存在")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *ContactHandler) RejectFriendRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.RejectFriendRequest(c.Request.Context(), uid, c.Param("id")); err != nil {
		response.Fail(c, http.StatusBadRequest, "申请不存在")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *ContactHandler) DeleteContact(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.DeleteContact(c.Request.Context(), uid, c.Param("id")); err != nil {
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *ContactHandler) BlockContact(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.BlockContact(c.Request.Context(), uid, c.Param("id")); err != nil {
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *ContactHandler) UnblockContact(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.UnblockContact(c.Request.Context(), uid, c.Param("id")); err != nil {
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *ContactHandler) GetConversation(c *gin.Context) {
	uid := middleware.UserID(c)
	convID, err := h.Svc.GetConversationID(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		if errors.Is(err, service.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "不是好友")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, convID)
}

type ChatHandler struct {
	Svc *service.ChatService
}

func (h *ChatHandler) ListConversations(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListConversations(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *ChatHandler) ListMessages(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListMessages(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		if errors.Is(err, service.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权访问会话")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

type sendMsgReq struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

func (h *ChatHandler) SendMessage(c *gin.Context) {
	uid := middleware.UserID(c)
	var req sendMsgReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Content == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	m, err := h.Svc.SendMessage(c.Request.Context(), uid, c.Param("id"), req.Type, req.Content)
	if err != nil {
		if errors.Is(err, service.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权访问会话")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "发送失败")
		return
	}
	response.OK(c, m)
}

func (h *ChatHandler) ReadAll(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.ReadAll(c.Request.Context(), uid); err != nil {
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
