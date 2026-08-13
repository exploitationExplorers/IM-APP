package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/response"

	"github.com/gin-gonic/gin"
)

// ===== 运行错误 / 导出（清单 10） =====

func (h *OpsHandler) ListErrorEvents(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListErrorEvents(c.Request.Context(), page, size)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OKPage(c, list, total, page, size)
}

func (h *OpsHandler) GetErrorEvent(c *gin.Context) {
	id, err := id64(c.Param("id"))
	if err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	e, err := h.Svc.GetErrorEvent(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "记录不存在")
		return
	}
	response.OK(c, e)
}

func (h *OpsHandler) CreateExport(c *gin.Context) {
	var req struct {
		Resource string `json:"resource" binding:"required"`
		Filters  string `json:"filters"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	id, err := h.Svc.CreateExportJob(c.Request.Context(), req.Resource, req.Filters, middleware.AdminID(c))
	if err != nil {
		response.Fail(c, 500, "创建失败")
		return
	}
	c.Set("auditReason", "创建导出任务 "+req.Resource)
	response.OK(c, gin.H{"id": id})
}

func (h *OpsHandler) ListExports(c *gin.Context) {
	page, size := pageParams(c)
	list, total, err := h.Svc.ListExportJobs(c.Request.Context(), middleware.AdminID(c), page, size)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OKPage(c, list, total, page, size)
}

// ===== 工作台（清单 02） =====

func (h *OpsHandler) DashboardOverview(c *gin.Context) {
	o, err := h.Svc.DashboardOverview(c.Request.Context())
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OK(c, o)
}

func (h *OpsHandler) DashboardTrends(c *gin.Context) {
	days := atoi(c.Query("days"), 7)
	list, err := h.Svc.DashboardTrends(c.Request.Context(), days)
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *OpsHandler) DashboardTodos(c *gin.Context) {
	list, err := h.Svc.DashboardTodos(c.Request.Context())
	if err != nil {
		response.Fail(c, 500, "查询失败")
		return
	}
	response.OK(c, list)
}
