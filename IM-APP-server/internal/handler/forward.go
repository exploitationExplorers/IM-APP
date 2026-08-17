package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type ForwardHandler struct {
	Svc *service.ForwardService
}

type createForwardReq struct {
	SourceMessageID      string                        `json:"sourceMessageId"`
	SourceConversationID string                        `json:"sourceConversationId"`
	SourceClientMsgID    string                        `json:"sourceClientMsgId"`
	SourceServerMsgID    string                        `json:"sourceServerMsgId"`
	SourceSnapshot       models.ForwardMessageSnapshot `json:"sourceSnapshot"`
	Selector             models.ForwardSelector        `json:"selector"`
	IdempotencyKey       string                        `json:"idempotencyKey"`
	TargetUserIDs        []string                      `json:"targetUserIds"`
}

func (h *ForwardHandler) Create(c *gin.Context) {
	uid := middleware.UserID(c)
	var req createForwardReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	task, err := h.Svc.Create(c.Request.Context(), uid, service.CreateForwardInput{
		SourceMessageID:      req.SourceMessageID,
		SourceConversationID: req.SourceConversationID,
		SourceClientMsgID:    req.SourceClientMsgID,
		SourceServerMsgID:    req.SourceServerMsgID,
		SourceSnapshot:       req.SourceSnapshot,
		Selector:             req.Selector,
		IdempotencyKey:       req.IdempotencyKey,
		TargetUserIDs:        req.TargetUserIDs,
	})
	if err != nil {
		forwardError(c, err)
		return
	}
	response.OK(c, task)
}

// GetLegacy 仅兼容旧 GET /forward-tasks/:id；新接口使用 query 参数。
func (h *ForwardHandler) GetLegacy(c *gin.Context) {
	h.get(c, c.Param("id"))
}

func (h *ForwardHandler) Progress(c *gin.Context) {
	h.get(c, c.Query("taskId"))
}

func (h *ForwardHandler) get(c *gin.Context, taskID string) {
	if taskID == "" {
		response.Fail(c, http.StatusBadRequest, "taskId不能为空")
		return
	}
	task, err := h.Svc.Get(c.Request.Context(), middleware.UserID(c), taskID)
	if err != nil {
		forwardError(c, err)
		return
	}
	response.OK(c, task)
}

func (h *ForwardHandler) List(c *gin.Context) {
	page, err := h.Svc.List(c.Request.Context(), middleware.UserID(c), c.Query("status"),
		c.Query("cursor"), queryInt(c, "limit", 20))
	if err != nil {
		forwardError(c, err)
		return
	}
	response.OK(c, page)
}

type taskTargetsReq struct {
	TaskID        string   `json:"taskId"`
	TargetUserIDs []string `json:"targetUserIds"`
}

func (h *ForwardHandler) AddTargets(c *gin.Context) {
	var req taskTargetsReq
	if !bindForwardJSON(c, &req) {
		return
	}
	count, err := h.Svc.AddTargets(c.Request.Context(), middleware.UserID(c), req.TaskID, req.TargetUserIDs)
	forwardCountResponse(c, count, err)
}

type generateTargetsReq struct {
	TaskID   string                 `json:"taskId"`
	Selector models.ForwardSelector `json:"selector"`
}

func (h *ForwardHandler) GenerateTargets(c *gin.Context) {
	var req generateTargetsReq
	if !bindForwardJSON(c, &req) {
		return
	}
	count, err := h.Svc.GenerateTargets(c.Request.Context(), middleware.UserID(c), req.TaskID, req.Selector)
	forwardCountResponse(c, count, err)
}

func (h *ForwardHandler) RemoveTargets(c *gin.Context) {
	var req taskTargetsReq
	if !bindForwardJSON(c, &req) {
		return
	}
	count, err := h.Svc.RemoveTargets(c.Request.Context(), middleware.UserID(c), req.TaskID, req.TargetUserIDs)
	forwardCountResponse(c, count, err)
}

type taskIDReq struct {
	TaskID string `json:"taskId"`
}

func (h *ForwardHandler) ClearTargets(c *gin.Context) {
	var req taskIDReq
	if !bindForwardJSON(c, &req) {
		return
	}
	count, err := h.Svc.ClearTargets(c.Request.Context(), middleware.UserID(c), req.TaskID)
	forwardCountResponse(c, count, err)
}

func (h *ForwardHandler) ListTargets(c *gin.Context) {
	page, err := h.Svc.ListTargets(c.Request.Context(), middleware.UserID(c), c.Query("taskId"),
		c.Query("status"), c.Query("cursor"), queryInt(c, "limit", 50))
	if err != nil {
		forwardError(c, err)
		return
	}
	response.OK(c, page)
}

func (h *ForwardHandler) Submit(c *gin.Context) {
	h.taskAction(c, h.Svc.Submit)
}

type cancelForwardReq struct {
	TaskID string `json:"taskId"`
	Reason string `json:"reason"`
}

func (h *ForwardHandler) Cancel(c *gin.Context) {
	var req cancelForwardReq
	if !bindForwardJSON(c, &req) {
		return
	}
	err := h.Svc.Cancel(c.Request.Context(), middleware.UserID(c), req.TaskID, req.Reason)
	forwardOKResponse(c, err)
}

func (h *ForwardHandler) Pause(c *gin.Context) {
	h.taskAction(c, h.Svc.Pause)
}

func (h *ForwardHandler) Resume(c *gin.Context) {
	h.taskAction(c, h.Svc.Resume)
}

type retryForwardReq struct {
	TaskID        string   `json:"taskId"`
	OnlyFailed    bool     `json:"onlyFailed"`
	TargetUserIDs []string `json:"targetUserIds"`
}

func (h *ForwardHandler) Retry(c *gin.Context) {
	var req retryForwardReq
	if !bindForwardJSON(c, &req) {
		return
	}
	count, err := h.Svc.Retry(c.Request.Context(), middleware.UserID(c), req.TaskID, req.OnlyFailed, req.TargetUserIDs)
	forwardCountResponse(c, count, err)
}

func (h *ForwardHandler) taskAction(c *gin.Context, action func(ctx context.Context, userID, taskID string) error) {
	var req taskIDReq
	if !bindForwardJSON(c, &req) {
		return
	}
	err := action(c.Request.Context(), middleware.UserID(c), req.TaskID)
	forwardOKResponse(c, err)
}

func bindForwardJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return false
	}
	return true
}

func forwardCountResponse(c *gin.Context, count int64, err error) {
	if err != nil {
		forwardError(c, err)
		return
	}
	response.OK(c, gin.H{"affectedCount": count})
}

func forwardOKResponse(c *gin.Context, err error) {
	if err != nil {
		forwardError(c, err)
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func forwardError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrForwardTaskNotFound):
		response.Fail(c, http.StatusNotFound, "转发任务不存在")
	case errors.Is(err, repository.ErrForwardTaskState), errors.Is(err, repository.ErrForwardIdempotencyReuse):
		response.Fail(c, http.StatusConflict, err.Error())
	case errors.Is(err, service.ErrForwardInvalidRequest):
		response.Fail(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrForwardUnavailable):
		response.Fail(c, http.StatusServiceUnavailable, err.Error())
	default:
		response.Fail(c, http.StatusInternalServerError, "转发服务处理失败")
	}
}

func queryInt(c *gin.Context, key string, fallback int) int {
	value, err := strconv.Atoi(c.Query(key))
	if err != nil {
		return fallback
	}
	return value
}
