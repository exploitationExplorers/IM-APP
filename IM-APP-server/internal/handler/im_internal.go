package handler

import (
	"errors"
	"net/http"
	"strconv"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

type IMInternalHandler struct {
	Service *service.IMAdminService
}

func (h *IMInternalHandler) SendMessage(c *gin.Context) {
	var req models.IMSystemMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	result, err := h.Service.SendSystemMessage(c.Request.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrIMTargetNotFound):
			response.Fail(c, http.StatusNotFound, "消息接收方不存在")
		case errors.Is(err, service.ErrIMRequestInProgress):
			response.Fail(c, http.StatusConflict, "相同幂等键的消息正在发送")
		case errors.Is(err, repository.ErrIMIdempotencyReuse):
			response.Fail(c, http.StatusConflict, "幂等键已用于其他消息请求")
		case errors.Is(err, service.ErrIMInvalidRequest):
			response.Fail(c, http.StatusBadRequest, "消息参数错误")
		case errors.Is(err, service.ErrIMUnavailable):
			response.Fail(c, http.StatusServiceUnavailable, "OpenIM 服务不可用")
		default:
			response.Fail(c, http.StatusBadGateway, "OpenIM 消息发送失败")
		}
		return
	}
	response.OK(c, result)
}

func (h *IMInternalHandler) Reconcile(c *gin.Context) {
	result, err := h.Service.Reconcile(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "创建 OpenIM 对账任务失败")
		return
	}
	response.OK(c, result)
}

func (h *IMInternalHandler) ListOutbox(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	items, err := h.Service.ListOutbox(c.Request.Context(), c.Query("status"), limit)
	if errors.Is(err, service.ErrIMInvalidRequest) {
		response.Fail(c, http.StatusBadRequest, "status 参数错误")
		return
	}
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询 OpenIM 同步任务失败")
		return
	}
	response.OK(c, items)
}

func (h *IMInternalHandler) ReplayOutbox(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "任务 ID 错误")
		return
	}
	replayed, err := h.Service.ReplayDead(c.Request.Context(), id)
	if errors.Is(err, service.ErrIMInvalidRequest) {
		response.Fail(c, http.StatusBadRequest, "任务 ID 错误")
		return
	}
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "重放 OpenIM 同步任务失败")
		return
	}
	if !replayed {
		response.Fail(c, http.StatusNotFound, "死信任务不存在")
		return
	}
	response.OK(c, gin.H{"replayed": true})
}

func (h *IMInternalHandler) Health(c *gin.Context) {
	response.OK(c, h.Service.Health(c.Request.Context()))
}
