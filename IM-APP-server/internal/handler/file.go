package handler

import (
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type FileHandler struct {
	MinIO *infra.MinIO
	Files *repository.FileRepo
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

// Uploads 创建上传任务：生成 fileId + 预签名上传地址（返回后文件为 pending）
func (h *FileHandler) Uploads(c *gin.Context) {
	var req models.CreateUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.FileName == "" || req.Purpose == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	userID := middleware.UserID(c)
	ext := path.Ext(req.FileName)
	if ext == "" {
		ext = ".bin"
	}
	objectKey := fmt.Sprintf("uploads/%s/%s%s", userID, uuid.NewString(), ext)

	var uploadURL, fileURL string
	if h.MinIO != nil && h.MinIO.Available() {
		res, err := h.MinIO.PresignPut(c.Request.Context(), objectKey, req.ContentType, 15*time.Minute)
		if err != nil {
			response.Fail(c, http.StatusInternalServerError, "生成上传凭证失败")
			return
		}
		uploadURL = res.UploadURL
		fileURL = res.FileURL
	} else {
		// 开发模式：直接给一个可访问地址
		base := strings.TrimSuffix(c.Request.Host, ":8080")
		fileURL = fmt.Sprintf("http://%s/static/%s", base, path.Base(objectKey))
		uploadURL = fileURL
	}

	f, err := h.Files.CreateFile(c.Request.Context(), userID, req.Purpose, req.FileName, req.ContentType, objectKey, req.SHA256, fileURL, req.Size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "创建上传任务失败")
		return
	}
	response.OK(c, models.UploadInitResult{
		File:      f,
		UploadURL: uploadURL,
		ExpiresIn: 900,
	})
}

// Complete 确认上传完成，文件转 ready 后可用于头像/消息
func (h *FileHandler) Complete(c *gin.Context) {
	f, err := h.Files.MarkReady(c.Request.Context(), c.Param("fileId"))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "文件不存在或已处理")
		return
	}
	response.OK(c, f)
}

// Get 查询已完成文件信息
func (h *FileHandler) Get(c *gin.Context) {
	f, err := h.Files.FindByID(c.Request.Context(), c.Param("fileId"))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "文件不存在")
		return
	}
	response.OK(c, f)
}
