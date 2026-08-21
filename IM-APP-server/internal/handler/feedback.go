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

type FeedbackHandler struct {
	Svc *service.FeedbackService
}

func (h *FeedbackHandler) Create(c *gin.Context) {
	var req models.CreateFeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "反馈参数错误")
		return
	}

	result, err := h.Svc.Create(c.Request.Context(), middleware.UserID(c), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidFeedbackRequest):
			response.Fail(c, http.StatusBadRequest, "反馈参数错误")
		case errors.Is(err, repository.ErrFeedbackImageInvalid):
			response.Fail(c, http.StatusBadRequest, "反馈图片不存在或不可用")
		case errors.Is(err, repository.ErrFeedbackTooFrequent):
			response.Fail(c, http.StatusTooManyRequests, "提交过于频繁，请稍后再试")
		default:
			response.Fail(c, http.StatusInternalServerError, "反馈提交失败")
		}
		return
	}
	response.OK(c, result)
}
