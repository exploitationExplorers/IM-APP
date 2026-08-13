package handler

import (
	"net/http"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/response"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
)

// AdminHandler 管理员认证、账号、角色、操作日志
type AdminHandler struct {
	Svc    *service.AdminService
	Secret string
}

// requirePerm 权限校验（无权限则中断并返回 403）
func requirePerm(c *gin.Context, svc *service.AdminService, perm string) bool {
	ok, _ := svc.HasPermission(c.Request.Context(), middleware.AdminID(c), perm)
	if !ok {
		response.Fail(c, http.StatusForbidden, "无权限操作")
		c.Abort()
		return false
	}
	return true
}

func (h *AdminHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Username == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	admin, err := h.Svc.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	token, _ := middleware.IssueToken(h.Secret, admin.ID)
	response.OK(c, models.LoginResult{Token: token, Admin: admin})
}

func (h *AdminHandler) Me(c *gin.Context) {
	adminID := middleware.AdminID(c)
	a, err := h.Svc.Repo.FindByID(c.Request.Context(), adminID)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "管理员不存在")
		return
	}
	response.OK(c, a)
}

func (h *AdminHandler) ListAdmins(c *gin.Context) {
	if !requirePerm(c, h.Svc, "admin.list") {
		return
	}
	list, err := h.Svc.ListAdmins(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *AdminHandler) CreateAdmin(c *gin.Context) {
	if !requirePerm(c, h.Svc, "admin.create") {
		return
	}
	var req models.AdminRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Username == "" || req.Password == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.CreateAdmin(c.Request.Context(), req); err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	h.Svc.LogOperation(c.Request.Context(), middleware.AdminID(c), "admin.create", "admin", req.Username, "", c.ClientIP())
	response.OK(c, gin.H{"ok": true})
}

func (h *AdminHandler) UpdateAdmin(c *gin.Context) {
	if !requirePerm(c, h.Svc, "admin.update") {
		return
	}
	var req models.AdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.UpdateAdmin(c.Request.Context(), c.Param("id"), req); err != nil {
		response.Fail(c, http.StatusBadRequest, "更新失败："+err.Error())
		return
	}
	h.Svc.LogOperation(c.Request.Context(), middleware.AdminID(c), "admin.update", "admin", c.Param("id"), "", c.ClientIP())
	response.OK(c, gin.H{"ok": true})
}

func (h *AdminHandler) ListRoles(c *gin.Context) {
	list, err := h.Svc.ListRoles(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

func (h *AdminHandler) CreateRole(c *gin.Context) {
	if !requirePerm(c, h.Svc, "role.create") {
		return
	}
	var req models.Role
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	id, err := h.Svc.CreateRole(c.Request.Context(), req.Name, req.Description)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "创建失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"id": id})
}

func (h *AdminHandler) SetRolePermissions(c *gin.Context) {
	if !requirePerm(c, h.Svc, "role.update") {
		return
	}
	var req struct {
		Permissions []string `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Svc.SetRolePermissions(c.Request.Context(), c.Param("id"), req.Permissions); err != nil {
		response.Fail(c, http.StatusBadRequest, "设置失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *AdminHandler) ListOperationLogs(c *gin.Context) {
	page, size := pageParams(c)
	list, err := h.Svc.ListOperationLogs(c.Request.Context(), size, (page-1)*size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "查询失败")
		return
	}
	response.OK(c, list)
}

// pageParams 解析 page/size，默认 page=1,size=20
func pageParams(c *gin.Context) (int, int) {
	page := atoi(c.Query("page"), 1)
	size := atoi(c.Query("size"), 20)
	if size > 100 {
		size = 100
	}
	return page, size
}

func atoi(s string, def int) int {
	if s == "" {
		return def
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	return n
}
