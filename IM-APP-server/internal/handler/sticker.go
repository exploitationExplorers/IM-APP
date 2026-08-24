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

// StickerHandler 自定义表情接口
type StickerHandler struct {
	Svc *service.StickerService
}

// List GET /stickers?page=&size=
func (h *StickerHandler) List(c *gin.Context) {
	uid := middleware.UserID(c)
	page, _ := strconv.Atoi(c.Query("page"))
	size, _ := strconv.Atoi(c.Query("size"))
	list, err := h.Svc.List(c.Request.Context(), uid, page, size)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, list)
}

// Create POST /stickers {fileId}
func (h *StickerHandler) Create(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateStickerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	item, err := h.Svc.Create(c.Request.Context(), uid, req.FileID)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, item)
}

// Delete POST /stickers/delete {stickerIds}
func (h *StickerHandler) Delete(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.DeleteStickersRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.Delete(c.Request.Context(), uid, req.StickerIDs); err != nil {
		if errors.Is(err, service.ErrNotFound) {
			response.Fail(c, http.StatusNotFound, "表情不存在")
			return
		}
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}
