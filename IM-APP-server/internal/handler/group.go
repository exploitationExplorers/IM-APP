package handler

import (
	"errors"
	"net/http"

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
	if err := h.Svc.UpdateSettings(c.Request.Context(), c.Param("id"), uid, req.Announcement, req.AllowMemberAddFriend); err != nil {
		if errors.Is(err, repository.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权限")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "更新失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *GroupHandler) Leave(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.Leave(c.Request.Context(), c.Param("id"), uid); err != nil {
		response.Fail(c, http.StatusInternalServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
