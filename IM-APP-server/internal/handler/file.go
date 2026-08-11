package handler

import (
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type FileHandler struct {
	MinIO *infra.MinIO
}

type presignReq struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
}

func (h *FileHandler) Presign(c *gin.Context) {
	if h.MinIO == nil || !h.MinIO.Available() {
		response.Fail(c, http.StatusServiceUnavailable, "文件服务未配置，请启用 MinIO")
		return
	}
	var req presignReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Filename == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	userID := middleware.UserID(c)
	ext := path.Ext(req.Filename)
	if ext == "" {
		ext = ".bin"
	}
	objectKey := fmt.Sprintf("users/%s/%s%s", userID, uuid.NewString(), ext)
	contentType := req.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	result, err := h.MinIO.PresignPut(c.Request.Context(), objectKey, contentType, 15*time.Minute)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "生成上传凭证失败")
		return
	}
	response.OK(c, result)
}

// DevPresign returns a fake upload URL when MinIO is unavailable (Mock/dev).
func DevPresign(c *gin.Context) {
	var req presignReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Filename == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	userID := middleware.UserID(c)
	ext := path.Ext(req.Filename)
	if ext == "" {
		ext = ".bin"
	}
	objectKey := fmt.Sprintf("dev/%s/%s%s", userID, uuid.NewString(), ext)
	base := strings.TrimSuffix(c.Request.Host, ":8080")
	fileURL := fmt.Sprintf("http://%s/static/%s", base, path.Base(objectKey))
	response.OK(c, gin.H{
		"uploadUrl":  fileURL,
		"fileUrl":    fileURL,
		"objectKey":  objectKey,
		"expiresIn":  900,
		"devMode":    true,
	})
}
