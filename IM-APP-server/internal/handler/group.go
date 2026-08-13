package handler

import (
	"errors"
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
		response.Fail(c, http.StatusInternalServerError, "创建失败")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) Detail(c *gin.Context) {
	uid := middleware.UserID(c)
	g, err := h.Svc.GetDetail(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "群不存在或无权访问")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) Members(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.Svc.ListMembers(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
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
		response.Fail(c, http.StatusBadRequest, "加入失败")
		return
	}
	response.OK(c, g)
}

func (h *GroupHandler) UpdateSettings(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.UpdateGroupSettingsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.UpdateSettings(c.Request.Context(), c.Param("id"), uid,
		req.Announcement, req.AllowMemberAddFriend, req.JoinMode, req.AllMuted); err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "更新失败")
		return
	}
	g, err := h.Svc.GetDetail(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		response.OK(c, gin.H{"ok": true})
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
	result, err := h.Svc.ResolveQRCode(c.Request.Context(), uid, token)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "二维码无效或已过期")
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

func (h *GroupHandler) UpdateMemberRole(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.UpdateMemberRoleReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Role == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.UpdateMemberRole(c.Request.Context(), c.Param("id"), uid, c.Param("userId"), req.Role); err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusBadRequest, err.Error())
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

func (h *GroupHandler) Dissolve(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.Dissolve(c.Request.Context(), c.Param("id"), uid); err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) MuteMember(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.MuteMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	var until *time.Time
	if req.MutedUntil != "" {
		t, err := time.Parse(time.RFC3339, req.MutedUntil)
		if err != nil {
			response.Fail(c, http.StatusBadRequest, "时间格式错误")
			return
		}
		until = &t
	}
	if err := h.Svc.MuteMember(c.Request.Context(), c.Param("id"), uid, c.Param("userId"), until); err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusBadRequest, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
