package handler

import (
	"net/http"

	"im-app-server/internal/middleware"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type ForwardHandler struct {
	Svc *service.ForwardService
}

type createForwardReq struct {
	SourceMessageID string   `json:"sourceMessageId"`
	TargetConvIDs   []string `json:"targetConvIds"`
}

func (h *ForwardHandler) Create(c *gin.Context) {
	uid := middleware.UserID(c)
	var req createForwardReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	task, err := h.Svc.Create(c.Request.Context(), uid, service.CreateForwardInput{
		SourceMessageID: req.SourceMessageID,
		TargetConvIDs:   req.TargetConvIDs,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, task)
}

func (h *ForwardHandler) Get(c *gin.Context) {
	uid := middleware.UserID(c)
	task, err := h.Svc.Get(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, err.Error())
		return
	}
	response.OK(c, task)
}
