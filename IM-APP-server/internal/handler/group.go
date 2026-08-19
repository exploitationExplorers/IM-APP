package handler

import (
	"errors"
	"log"
	"net/http"
	"time"

	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type GroupHandler struct {
	Svc *service.GroupService
}

func (h *GroupHandler) Create(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateGroupReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	g, err := h.Svc.Create(c.Request.Context(), uid, req.Name, req.MemberIDs)
	if err != nil {
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "创建群聊至少需要 3 名有效成员（包含群主）")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "创建失败")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) Detail(c *gin.Context) {
	h.detail(c, c.Param("id"))
}

func (h *GroupHandler) DetailStatic(c *gin.Context) {
	groupID := c.Query("groupId")
	if groupID == "" {
		response.Fail(c, http.StatusBadRequest, "groupId 必填")
		return
	}
	h.detail(c, groupID)
}

func (h *GroupHandler) detail(c *gin.Context, groupID string) {
	uid := middleware.UserID(c)
	g, err := h.Svc.GetDetail(c.Request.Context(), groupID, uid)
	if err != nil {
		log.Printf("get group %s: %v", groupID, err)
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "群聊 ID 不正确")
			return
		}
		response.Fail(c, http.StatusNotFound, "群不存在或无权访问")
		return
	}
	response.OK(c, g)
}

// DissolvedInfo 已解散群轻量资料（通讯录只读展示用）
func (h *GroupHandler) DissolvedInfo(c *gin.Context) {
	g, err := h.Svc.GetDissolvedInfo(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, repository.ErrGroupNotFound) {
			response.Fail(c, http.StatusNotFound, "群不存在")
			return
		}
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "群聊 ID 不正确")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, g)
}

// RemoveDissolvedGroup 成员删除已解散群（仅移除自己的成员记录）
func (h *GroupHandler) RemoveDissolvedGroup(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.RemoveDissolvedGroup(c.Request.Context(), c.Param("id"), uid); err != nil {
		if errors.Is(err, repository.ErrGroupNotFound) {
			response.Fail(c, http.StatusNotFound, "群不存在")
			return
		}
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "该群不是已解散状态")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) Members(c *gin.Context) {
	uid := middleware.UserID(c)
	groupID := c.Query("groupId")
	if groupID == "" {
		response.Fail(c, http.StatusBadRequest, "groupId 必填")
		return
	}
	list, err := h.Svc.ListMembers(c.Request.Context(), groupID, uid)
	if err != nil {
		if errors.Is(err, repository.ErrGroupNotFound) {
			response.Fail(c, http.StatusNotFound, "群不存在")
			return
		}
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权访问")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *GroupHandler) Join(c *gin.Context) {
	uid := middleware.UserID(c)
	g, err := h.Svc.Join(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		if errors.Is(err, repository.ErrApprovalRequired) {
			response.Fail(c, http.StatusConflict, "该群需要管理员审核，请提交入群申请")
			return
		}
		response.Fail(c, http.StatusBadRequest, "加入失败")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) UpdateSettings(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.UpdateGroupSettingsReq
	if err := bindBusinessJSON(c, &req); err != nil || req.GroupID == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.UpdateSettings(c.Request.Context(), req.GroupID, uid,
		req.Name, req.AvatarFileID, req.Announcement,
		req.AllowMemberAddFriend, req.JoinMode, req.AllMuted); err != nil {
		if errors.Is(err, repository.ErrGroupNotFound) {
			response.Fail(c, http.StatusNotFound, "群不存在")
			return
		}
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		if errors.Is(err, repository.ErrInvalidGroupOperation) {
			response.Fail(c, http.StatusBadRequest, "群设置参数错误")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "更新失败")
		return
	}
	g, err := h.Svc.GetDetail(c.Request.Context(), req.GroupID, uid)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "更新后查询群详情失败")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) Leave(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.Leave(c.Request.Context(), c.Param("id"), uid); err != nil {
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) Qrcode(c *gin.Context) {
	uid := middleware.UserID(c)
	result, err := h.Svc.Qrcode(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "生成失败")
		return
	}
	response.OK(c, result)
}

func (h *GroupHandler) ResolveQRCode(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.ResolveQRCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	token := req.Token
	if token == "" && req.Payload != "" {
		token = extractQRToken(req.Payload)
	}
	if token == "" && req.QRCode != "" {
		token = extractQRToken(req.QRCode)
	}
	result, err := h.Svc.ResolveQRCode(c.Request.Context(), uid, token)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "二维码无效或已过期")
		return
	}
	response.OK(c, result)
}

func (h *GroupHandler) JoinByQRCode(c *gin.Context) {
	var req models.JoinGroupByQRCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	token := req.Token
	if token == "" && req.Payload != "" {
		token = extractQRToken(req.Payload)
	}
	if token == "" && req.QRCode != "" {
		token = extractQRToken(req.QRCode)
	}
	result, err := h.Svc.JoinByQRCode(c.Request.Context(), middleware.UserID(c), token, req.Remark)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrInvalidGroupOperation):
			response.Fail(c, http.StatusBadRequest, "参数错误")
		default:
			response.Fail(c, http.StatusNotFound, "二维码无效、已过期或群不可加入")
		}
		return
	}
	response.OK(c, result)
}

func (h *GroupHandler) UpdateMyNickname(c *gin.Context) {
	var req models.UpdateMyGroupNicknameReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	err := h.Svc.UpdateMyNickname(c.Request.Context(), c.Param("id"), middleware.UserID(c), req.Nickname)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrForbidden):
			response.Fail(c, http.StatusForbidden, "不是有效群成员")
		case errors.Is(err, repository.ErrInvalidGroupOperation):
			response.Fail(c, http.StatusBadRequest, "群昵称最多 32 个字")
		default:
			response.Fail(c, http.StatusInternalServerError, "更新失败")
		}
		return
	}
	g, err := h.Svc.GetDetail(c.Request.Context(), c.Param("id"), middleware.UserID(c))
	if err != nil {
		response.OK(c, gin.H{"ok": true})
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) CreateReport(c *gin.Context) {
	var req models.CreateGroupReportReq
	if err := c.ShouldBindJSON(&req); err != nil || req.GroupID == "" || req.Reason == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	result, err := h.Svc.CreateReport(c.Request.Context(), req.GroupID, middleware.UserID(c), req.Reason, req.Description, req.ImageFileIDs)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrForbidden):
			response.Fail(c, http.StatusForbidden, "不是有效群成员")
		case errors.Is(err, repository.ErrInvalidGroupOperation):
			response.Fail(c, http.StatusBadRequest, "举报参数错误")
		default:
			response.Fail(c, http.StatusInternalServerError, "举报提交失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *GroupHandler) InviteMembers(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.InviteGroupMembersReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.UserIDs) == 0 {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	count, err := h.Svc.InviteMembers(c.Request.Context(), c.Param("id"), uid, req.UserIDs)
	if err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "邀请失败")
		return
	}
	response.OK(c, gin.H{"ok": true, "invitedCount": count})
}

func (h *GroupHandler) AcceptInvitation(c *gin.Context) {
	uid := middleware.UserID(c)
	g, err := h.Svc.AcceptInvitation(c.Request.Context(), uid, c.Param("token"))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "邀请无效或已过期")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) CreateJoinRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateGroupJoinReq
	_ = c.ShouldBindJSON(&req)
	item, err := h.Svc.CreateJoinRequest(c.Request.Context(), c.Param("id"), uid, req.Remark)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "提交失败")
		return
	}
	response.OK(c, item)
}

func (h *GroupHandler) ListJoinRequests(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListJoinRequests(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *GroupHandler) ApproveJoinRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	g, err := h.Svc.ApproveJoinRequest(c.Request.Context(), c.Param("id"), uid, c.Param("requestId"))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) RejectJoinRequest(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.RejectJoinRequest(c.Request.Context(), c.Param("id"), uid, c.Param("requestId")); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) RemoveMember(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.RemoveMember(c.Request.Context(), c.Param("id"), uid, c.Param("userId")); err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusBadRequest, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) UpdateMemberRole(c *gin.Context) {
	var req models.UpdateGroupMemberRoleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	err := h.Svc.UpdateMemberRole(c.Request.Context(), c.Param("id"), middleware.UserID(c), c.Param("userId"), req.Role)
	h.handleModerationResult(c, err)
}

func (h *GroupHandler) MuteMember(c *gin.Context) {
	var req models.MuteGroupMemberReq
	if err := bindBusinessJSON(c, &req); err != nil || req.GroupID == "" || req.MemberUserID == "" ||
		req.MutedSeconds == nil || *req.MutedSeconds < 1 || *req.MutedSeconds > 30*24*60*60 {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	mutedUntil, err := h.Svc.UpdateMemberMute(c.Request.Context(), req.GroupID, middleware.UserID(c), req.MemberUserID, *req.MutedSeconds)
	if !h.handleMemberMuteError(c, err) {
		return
	}
	response.OK(c, models.GroupMemberMuteResult{
		GroupID: req.GroupID, MemberUserID: req.MemberUserID, IsMuted: mutedUntil != nil,
		MutedUntil: mutedUntil, ChangedAt: time.Now().UTC(),
	})
}

func (h *GroupHandler) UnmuteMember(c *gin.Context) {
	var req models.UnmuteGroupMemberReq
	if err := bindBusinessJSON(c, &req); err != nil || req.GroupID == "" || req.MemberUserID == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	mutedUntil, err := h.Svc.UpdateMemberMute(c.Request.Context(), req.GroupID, middleware.UserID(c), req.MemberUserID, 0)
	if !h.handleMemberMuteError(c, err) {
		return
	}
	response.OK(c, models.GroupMemberMuteResult{
		GroupID: req.GroupID, MemberUserID: req.MemberUserID, IsMuted: false,
		MutedUntil: mutedUntil, ChangedAt: time.Now().UTC(),
	})
}

func (h *GroupHandler) handleMemberMuteError(c *gin.Context, err error) bool {
	if err == nil {
		return true
	}
	switch {
	case errors.Is(err, repository.ErrGroupNotFound):
		response.Fail(c, http.StatusNotFound, "群不存在")
	case errors.Is(err, repository.ErrForbidden):
		response.Fail(c, http.StatusForbidden, "无权限")
	case errors.Is(err, repository.ErrInvalidGroupOperation):
		response.Fail(c, http.StatusBadRequest, "群操作参数错误")
	default:
		response.Fail(c, http.StatusInternalServerError, "群操作失败")
	}
	return false
}

func (h *GroupHandler) Dismiss(c *gin.Context) {
	h.handleModerationResult(c, h.Svc.Dismiss(c.Request.Context(), c.Param("id"), middleware.UserID(c)))
}

func (h *GroupHandler) handleModerationResult(c *gin.Context, err error) {
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrForbidden):
			response.Fail(c, http.StatusForbidden, "无权限")
		case errors.Is(err, repository.ErrInvalidGroupOperation):
			response.Fail(c, http.StatusBadRequest, "群操作参数错误")
		default:
			response.Fail(c, http.StatusInternalServerError, "群操作失败")
		}
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) UpdateGroupRemark(c *gin.Context) {
	var req models.UpdateGroupRemarkReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.UpdateGroupRemark(c.Request.Context(), c.Param("id"), middleware.UserID(c), req.Remark); err != nil {
		response.Fail(c, http.StatusBadRequest, "群备注最多 64 个字")
		return
	}
	g, err := h.Svc.GetDetail(c.Request.Context(), c.Param("id"), middleware.UserID(c))
	if err != nil {
		response.OK(c, gin.H{"ok": true})
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) UpdateMemberRemark(c *gin.Context) {
	var req models.UpdateMemberRemarkReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.UpdateMemberRemark(c.Request.Context(), c.Param("id"), middleware.UserID(c), c.Param("userId"), req.Remark); err != nil {
		response.Fail(c, http.StatusBadRequest, "成员备注最多 64 个字")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
