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

type ReportHandler struct {
	Svc *service.ReportService
}

func (h *ReportHandler) ListReasons(c *gin.Context) {
	items, err := h.Svc.ListReasons(c.Request.Context(), c.Query("targetType"), c.DefaultQuery("language", "zh"))
	if err != nil {
		if errors.Is(err, service.ErrInvalidReportRequest) {
			response.Fail(c, http.StatusBadRequest, "举报原因参数错误")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "获取举报原因失败")
		return
	}
	response.OK(c, items)
}

func (h *ReportHandler) Create(c *gin.Context) {
	var req models.CreateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "举报参数错误")
		return
	}

	result, err := h.Svc.Create(c.Request.Context(), middleware.UserID(c), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidReportRequest):
			response.Fail(c, http.StatusBadRequest, "举报参数错误")
		case errors.Is(err, service.ErrCannotReportSelf):
			response.Fail(c, http.StatusBadRequest, "不能举报自己")
		case errors.Is(err, repository.ErrReportTargetNotFound):
			response.Fail(c, http.StatusNotFound, "被举报用户不存在")
		case errors.Is(err, repository.ErrReportReasonNotFound):
			response.Fail(c, http.StatusBadRequest, "举报原因不存在或已停用")
		case errors.Is(err, repository.ErrReportEvidenceInvalid):
			response.Fail(c, http.StatusBadRequest, "举报证据文件不存在或不可用")
		default:
			response.Fail(c, http.StatusInternalServerError, "举报提交失败")
		}
		return
	}
	response.OK(c, result)
}
