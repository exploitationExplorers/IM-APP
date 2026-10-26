package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/moderation"
	"im-app-server/internal/response"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type FileHandler struct {
	Storage    *infra.Storage
	Files      FileRepository
	Moderation *moderation.Client
}

type FileRepository interface {
	CreateFile(context.Context, string, string, string, string, string, string, string, int64, string, string) (models.FileObject, error)
	FindPendingByID(context.Context, string, string) (models.PendingFile, error)
	MarkReady(context.Context, string, string) (models.FileObject, error)
	FindByID(context.Context, string, string) (models.FileObject, error)
}

type presignReq struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
}

func (h *FileHandler) Presign(c *gin.Context) {
	if !h.Storage.Available() {
		response.Fail(c, http.StatusServiceUnavailable, "文件服务未配置")
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
	store := h.Storage.Current
	objectKey, err := store.NewKey(objectKey)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "文件名无效")
		return
	}
	contentType := req.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	uploadURL, formData, err := store.PresignPost(c.Request.Context(), objectKey, contentType, 15*time.Minute)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "生成上传凭证失败")
		return
	}
	response.OK(c, gin.H{
		"uploadUrl": uploadURL,
		"formUrl":   uploadURL,
		"formData":  formData,
		"fileUrl":   store.FileURL(objectKey),
		"objectKey": objectKey,
		"expiresIn": 900,
	})
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
		"uploadUrl": fileURL,
		"formUrl":   fileURL,
		"formData":  gin.H{},
		"fileUrl":   fileURL,
		"objectKey": objectKey,
		"expiresIn": 900,
		"devMode":   true,
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

	var uploadURL, fileURL, formURL string
	var formData map[string]string
	provider, bucket := "minio", ""
	if h.Storage.Available() {
		store := h.Storage.Current
		provider, bucket = store.Provider(), store.BucketName()
		if provider == "oss" && req.Purpose == "avatar" {
			objectKey = fmt.Sprintf("avatars/%s/%s%s", userID, uuid.NewString(), ext)
		}
		if provider == "oss" && (req.Size <= 0 || req.Size > infra.MaxFormUploadBytes) {
			response.Fail(c, http.StatusBadRequest, "文件大小须在 1 字节至 20 MiB 之间")
			return
		}
		var err error
		objectKey, err = store.NewKey(objectKey)
		if err != nil {
			response.Fail(c, http.StatusBadRequest, "文件名无效")
			return
		}
		formURL, formData, err = store.PresignPost(c.Request.Context(), objectKey, req.ContentType, 15*time.Minute)
		if err != nil {
			response.Fail(c, http.StatusInternalServerError, "生成上传凭证失败")
			return
		}
		uploadURL = formURL
		fileURL = store.FileURL(objectKey)
	} else {
		// 开发模式：直接给一个可访问地址
		base := strings.TrimSuffix(c.Request.Host, ":8080")
		fileURL = fmt.Sprintf("http://%s/static/%s", base, path.Base(objectKey))
		uploadURL = fileURL
	}

	f, err := h.Files.CreateFile(c.Request.Context(), userID, req.Purpose, req.FileName, req.ContentType, objectKey, req.SHA256, fileURL, req.Size, provider, bucket)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "创建上传任务失败")
		return
	}
	response.OK(c, models.UploadInitResult{
		File:      f,
		UploadURL: uploadURL,
		FormURL:   formURL,
		FormData:  formData,
		ExpiresIn: 900,
	})
}

// Complete 确认上传完成，文件转 ready 后可用于头像/消息
func (h *FileHandler) Complete(c *gin.Context) {
	var req models.CompleteUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.FileID) == "" {
		response.Fail(c, http.StatusBadRequest, "fileId 必填")
		return
	}
	userID := middleware.UserID(c)
	pending, err := h.Files.FindPendingByID(c.Request.Context(), req.FileID, userID)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "文件不存在或已处理")
		return
	}
	// Preserve the unconfigured local-dev behavior only for dev-created tasks.
	devTask := !h.Storage.Available() && pending.StorageProvider == "minio" && pending.StorageBucket == ""
	if devTask && h.Moderation != nil {
		response.Fail(c, http.StatusServiceUnavailable, "内容审核需要可用的文件存储")
		return
	}
	if !devTask {
		store, err := h.Storage.ForLocation(pending.StorageProvider, pending.StorageBucket)
		if err != nil {
			response.Fail(c, http.StatusServiceUnavailable, "文件所属存储不可用")
			return
		}
		info, err := store.Stat(c.Request.Context(), pending.ObjectKey)
		if err != nil {
			if errors.Is(err, infra.ErrObjectNotFound) {
				response.Fail(c, http.StatusBadRequest, "文件未上传成功，请重新上传")
			} else {
				response.Fail(c, http.StatusServiceUnavailable, "检查上传结果失败，请稍后重试")
			}
			return
		}
		// Keep legacy MinIO completion semantics; stricter declaration checks are
		// opt-in with OSS and must not break older App clients/pending tasks.
		if info.Size <= 0 || (store.Provider() == "oss" && (info.Size > infra.MaxFormUploadBytes || (pending.Size > 0 && info.Size != pending.Size))) {
			response.Fail(c, http.StatusBadRequest, "文件大小与上传声明不符，请重新上传")
			return
		}
		if strings.HasPrefix(strings.ToLower(pending.ContentType), "image/") {
			if err := h.Moderation.CheckImages(c.Request.Context(), []string{store.FileURL(pending.ObjectKey)}); err != nil {
				response.Fail(c, http.StatusUnprocessableEntity, err.Error())
				return
			}
		}
	}
	f, err := h.Files.MarkReady(c.Request.Context(), req.FileID, userID)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "文件不存在或已处理")
		return
	}
	response.OK(c, f)
}

// Get 查询已完成文件信息
func (h *FileHandler) Get(c *gin.Context) {
	fileID := strings.TrimSpace(c.Query("fileId"))
	if fileID == "" {
		response.Fail(c, http.StatusBadRequest, "fileId 必填")
		return
	}
	f, err := h.Files.FindByID(c.Request.Context(), fileID, middleware.UserID(c))
	if err != nil {
		response.Fail(c, http.StatusNotFound, "文件不存在")
		return
	}
	response.OK(c, f)
}
