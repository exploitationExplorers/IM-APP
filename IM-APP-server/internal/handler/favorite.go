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

// List 收藏列表 GET /favorites?type=image&page=1&limit=20 （type 不传=全部）
func (h *FavoriteHandler) List(c *gin.Context) {
	uid := middleware.UserID(c)
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.Query("limit"))
	if size < 1 || size > 100 {
		size = 20
	}
	list, err := h.Svc.List(c.Request.Context(), uid, c.Query("type"), page, size)
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
