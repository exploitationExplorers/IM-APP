package handler

import (
	"errors"
	"net/http"

	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

// FavoriteHandler 收藏接口
type FavoriteHandler struct {
	Svc *service.FavoriteService
}

// Create 收藏一条消息 POST /favorites {messageId}
func (h *FavoriteHandler) Create(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateFavoriteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.MessageID == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	f, err := h.Svc.Create(c.Request.Context(), uid, req.MessageID)
	if err != nil {
		if errors.Is(err, service.ErrForbidden) {
			response.Fail(c, http.StatusForbidden, "无权收藏该消息")
			return
		}
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, f)
}

type favoriteListReq struct {
	Page int `json:"page"`
	Size int `json:"size"`
	Type int `json:"type"` // 0全部 1文字 2图片视频 3文件 4语音
}

// List 收藏列表 POST /favorites/list {page,size,type}
func (h *FavoriteHandler) List(c *gin.Context) {
	uid := middleware.UserID(c)
	var req favoriteListReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.Size < 1 || req.Size > 100 {
		req.Size = 20
	}
	list, err := h.Svc.List(c.Request.Context(), uid, req.Type, req.Page, req.Size)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, list)
}

// Delete 取消收藏 DELETE /favorites/:favoriteId
func (h *FavoriteHandler) Delete(c *gin.Context) {
	uid := middleware.UserID(c)
	if err := h.Svc.Delete(c.Request.Context(), uid, c.Param("favoriteId")); err != nil {
		response.Fail(c, http.StatusNotFound, "收藏不存在")
		return
	}
	response.OK(c, gin.H{"ok": true})
}
