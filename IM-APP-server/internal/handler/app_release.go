package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"im-app-server/internal/models"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type AppReleaseHandler struct {
	Svc *service.AppReleaseService
}

func (h *AppReleaseHandler) Check(c *gin.Context) {
	nativeVersion, err := strconv.Atoi(strings.TrimSpace(c.Query("nativeVersion")))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "nativeVersion 无效")
		return
	}
	wgtVersion, err := strconv.Atoi(strings.TrimSpace(c.Query("wgtVersion")))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "wgtVersion 无效")
		return
	}
	result, err := h.Svc.Check(c.Request.Context(), c.Query("platform"), c.Query("channel"), nativeVersion, wgtVersion)
	if err != nil {
		if errors.Is(err, service.ErrInvalidAppRelease) {
			response.Fail(c, http.StatusBadRequest, "检查更新参数错误")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "检查更新失败")
		return
	}
	response.OK(c, result)
}

func (h *AppReleaseHandler) CreateUpload(c *gin.Context) {
	var req models.CreateAppReleaseUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "上传参数错误")
		return
	}
	result, err := h.Svc.CreateUpload(c.Request.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAppRelease):
			response.Fail(c, http.StatusBadRequest, "上传参数错误")
		case errors.Is(err, service.ErrAppReleaseStorage):
			response.Fail(c, http.StatusServiceUnavailable, "文件服务未配置")
		default:
			response.Fail(c, http.StatusInternalServerError, "生成上传凭证失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *AppReleaseHandler) Publish(c *gin.Context) {
	var req models.PublishAppReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "发布参数错误")
		return
	}
	result, err := h.Svc.Publish(c.Request.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidAppRelease):
			response.Fail(c, http.StatusBadRequest, "发布参数错误")
		case errors.Is(err, service.ErrAppReleaseStorage):
			response.Fail(c, http.StatusServiceUnavailable, "文件服务未配置")
		case errors.Is(err, service.ErrAppReleaseObjectMissing):
			response.Fail(c, http.StatusBadRequest, "安装包尚未上传完成")
		case errors.Is(err, service.ErrAppReleaseVersionUsed):
			response.Fail(c, http.StatusConflict, "该版本号已发布")
		default:
			response.Fail(c, http.StatusInternalServerError, "发布失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *AppReleaseHandler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(strings.TrimSpace(c.Query("limit")))
	list, err := h.Svc.List(c.Request.Context(), c.Query("platform"), c.Query("channel"), limit)
	if err != nil {
		if errors.Is(err, service.ErrInvalidAppRelease) {
			response.Fail(c, http.StatusBadRequest, "查询参数错误")
			return
		}
		response.Fail(c, http.StatusInternalServerError, "查询发布记录失败")
		return
	}
	response.OK(c, list)
}
