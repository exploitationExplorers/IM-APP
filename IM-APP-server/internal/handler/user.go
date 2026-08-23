package handler

import (
	"errors"
	"net/http"
	"strconv"

	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
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

func (h *UserHandler) VerifyPassword(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.VerifyPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.OldPassword == "" {
		response.Fail(c, http.StatusBadRequest, "请输入旧密码")
		return
	}
	if err := h.Svc.VerifyPassword(c.Request.Context(), uid, req.OldPassword); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.Fail(c, http.StatusNotFound, "用户不存在")
			return
		}
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *UserHandler) ChangePassword(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Password == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.ChangePassword(c.Request.Context(), uid, req.Password, req.OldPassword); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.Fail(c, http.StatusNotFound, "用户不存在")
			return
		}
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *UserHandler) GetPrivacySettings(c *gin.Context) {
	uid := middleware.UserID(c)
	s, err := h.Svc.GetPrivacySettings(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "获取隐私设置失败")
		return
	}
	response.OK(c, s)
}

func (h *UserHandler) UpdatePrivacySettings(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.PrivacySettings
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	s, err := h.Svc.UpdatePrivacySettings(c.Request.Context(), uid, req)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "更新隐私设置失败")
		return
	}
	response.OK(c, s)
}

func (h *UserHandler) ResolveUserQRCode(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.ResolveQRCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	token := req.Token
	if token == "" && req.QRCode != "" {
		token = extractQRToken(req.QRCode)
	}
	if token == "" && req.Payload != "" {
		token = extractQRToken(req.Payload)
	}
	result, err := h.Svc.ResolveUserQRCode(c.Request.Context(), uid, token)
	if err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.Fail(c, http.StatusNotFound, "二维码无效或已过期")
			return
		}
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, result)
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
	sort := c.DefaultQuery("sort", "recent")
	if sort == "chat" {
		sort = "recent"
	}
	page, err := h.Svc.ListContacts(c.Request.Context(), uid, c.Query("keyword"), sort, c.Query("cursor"), queryInt(c, "limit", 50))
	if err != nil {
		if errors.Is(err, service.ErrInvalidContactQuery) {
			response.Fail(c, http.StatusBadRequest, "参数错误")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, page)
}

func (h *ContactHandler) ListGroups(c *gin.Context) {
	uid := middleware.UserID(c)
	role := c.Query("role")
	page, err := h.Svc.ListGroups(c.Request.Context(), uid, role, c.Query("cursor"), queryInt(c, "limit", 100))
	if err != nil {
		response.OK(c, models.GroupPage{Items: []models.GroupPreview{}})
		return
	}
	response.OK(c, page)
}

func (h *ContactHandler) ListFriendRequests(c *gin.Context) {
	uid := middleware.UserID(c)
	direction := c.Query("direction")
	if direction == "" && c.Request.Method == http.MethodPost {
		var req struct {
			Direction string `json:"direction"`
		}
		_ = c.ShouldBindJSON(&req)
		direction = req.Direction
	}
	list, err := h.Svc.ListFriendRequests(c.Request.Context(), uid, direction)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

type friendRequestReq struct {
	ToUserID      string `json:"toUserId"`
	Message       string `json:"message"`
	Source        string `json:"source"`
	SourceGroupID string `json:"sourceGroupId"`
}

func (h *ContactHandler) CreateFriendRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	var req friendRequestReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ToUserID == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	result, err := h.Svc.SendFriendRequest(c.Request.Context(), uid, req.ToUserID, req.Message, req.Source, req.SourceGroupID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidFriendRequest):
			response.Fail(c, http.StatusBadRequest, "好友申请参数错误")
		case errors.Is(err, service.ErrSelfAction):
			response.Fail(c, http.StatusBadRequest, "不能添加自己")
		case errors.Is(err, service.ErrAlreadyFriend):
			response.Fail(c, http.StatusBadRequest, "已经是好友")
		case errors.Is(err, service.ErrNotFound):
			response.Fail(c, http.StatusNotFound, "用户或群不存在")
		case errors.Is(err, service.ErrForbidden):
			response.Fail(c, http.StatusForbidden, "无法发送好友申请")
		default:
			response.Fail(c, http.StatusInternalServerError, "发送失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *ContactHandler) CreateGroupFriendRequest(c *gin.Context) {
	var req models.CreateGroupFriendRequest
	if err := bindBusinessJSON(c, &req); err != nil || req.GroupID == "" || req.ToUserID == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	result, err := h.Svc.SendGroupFriendRequest(c.Request.Context(), middleware.UserID(c), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidFriendRequest), errors.Is(err, service.ErrSelfAction):
			response.Fail(c, http.StatusBadRequest, "好友申请参数错误")
		case errors.Is(err, service.ErrAlreadyFriend):
			response.Fail(c, http.StatusConflict, "已经是好友")
		case errors.Is(err, service.ErrNotFound):
			response.Fail(c, http.StatusNotFound, "用户或群不存在")
		case errors.Is(err, service.ErrForbidden):
			response.Fail(c, http.StatusForbidden, "群内禁止添加好友或无权访问")
		default:
			response.Fail(c, http.StatusInternalServerError, "发送失败")
		}
		return
	}
	response.OK(c, result)
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

func (h *ContactHandler) ListBlockedContacts(c *gin.Context) {
	uid := middleware.UserID(c)
	keyword := c.Query("keyword")
	limit := 100
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			limit = n
		}
	}
	resp, err := h.Svc.ListBlockedContacts(c.Request.Context(), uid, keyword, limit)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, resp)
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

func (h *ContactHandler) GetContact(c *gin.Context) {
	uid := middleware.UserID(c)
	cid := c.Param("id")
	item, err := h.Svc.GetContact(c.Request.Context(), uid, cid)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "好友不存在")
		return
	}
	response.OK(c, item)
}

func (h *ContactHandler) UpdateContact(c *gin.Context) {
	uid := middleware.UserID(c)
	cid := c.Param("id")
	var req models.UpdateContactReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	item, err := h.Svc.UpdateContact(c.Request.Context(), uid, cid, req.Remark, req.TagIDs)
	if err != nil {
		if err.Error() == "标签功能不可用" {
			response.Fail(c, http.StatusBadRequest, err.Error())
			return
		}
		response.Fail(c, http.StatusNotFound, "好友不存在")
		return
	}
	response.OK(c, item)
}

func (h *ContactHandler) ListTags(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListTags(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *ContactHandler) CreateTag(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.SaveContactTagReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	item, err := h.Svc.CreateTag(c.Request.Context(), uid, req.Name)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, item)
}

func (h *ContactHandler) UpdateTag(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.SaveContactTagReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	item, err := h.Svc.UpdateTag(c.Request.Context(), uid, c.Param("tagId"), req.Name)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "标签不存在")
		return
	}
	response.OK(c, item)
}

func (h *ContactHandler) DeleteTag(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.DeleteTag(c.Request.Context(), uid, c.Param("tagId")); err != nil {
		response.Fail(c, http.StatusNotFound, "标签不存在")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *ContactHandler) SetTagMembers(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.SetTagMembersReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	item, err := h.Svc.SetTagMembers(c.Request.Context(), uid, c.Param("tagId"), req.UserIDs)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "标签不存在")
		return
	}
	response.OK(c, item)
}

func (h *ContactHandler) ListTagMembers(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListTagMembers(c.Request.Context(), uid, c.Param("tagId"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "标签不存在")
		return
	}
	response.OK(c, list)
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
