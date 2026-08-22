package handler

import (
	"net/http"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminGroupHandler 管理端群操作（由管理后台经 /internal/admin 内部密钥调用）
// Repo 直接走 DB，避开 service.GroupService（后者只服务 APP 端，用数字 publicID 做转换）
type AdminGroupHandler struct {
	Groups *service.GroupService
	Repo   *repository.GroupRepo
}

// AdminForwardHandler 管理端转发任务操作（由管理后台经 /internal/admin 内部密钥调用）
type AdminForwardHandler struct {
	Forward *service.ForwardService
}

func (h *AdminForwardHandler) GetForwardSettings(c *gin.Context) {
	settings, err := h.Forward.Repo.GetDeliverySettings(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "读取转发调度配置失败")
		return
	}
	response.OK(c, settings)
}

func (h *AdminForwardHandler) GetForwardQueueMetrics(c *gin.Context) {
	metrics, err := h.Forward.Repo.GetQueueMetrics(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "读取转发队列指标失败")
		return
	}
	response.OK(c, metrics)
}

func (h *AdminForwardHandler) UpdateForwardSettings(c *gin.Context) {
	var req struct {
		models.ForwardDeliverySettings
		AdminID string `json:"adminId"`
		Reason  string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" ||
		req.GlobalQPS <= 0 || req.WorkerConcurrency <= 0 || req.ClaimBatchSize <= 0 ||
		req.PerUserConcurrency <= 0 || req.RetryBaseSeconds <= 0 || req.RetryMaxSeconds < req.RetryBaseSeconds ||
		req.ProcessingLockSeconds <= 0 || req.RetentionDays <= 0 || req.QueueAlertDepth <= 0 {
		response.Fail(c, http.StatusBadRequest, "调度参数或 reason 无效")
		return
	}
	if err := h.Forward.Repo.UpdateDeliverySettings(c.Request.Context(), req.ForwardDeliverySettings, req.AdminID, req.Reason); err != nil {
		response.Fail(c, http.StatusInternalServerError, "保存转发调度配置失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// AdminUserHandler 管理端用户限制操作（由管理后台经 /internal/admin 内部密钥调用）
type AdminUserHandler struct {
	Restrictions *repository.RestrictionRepo
	Client       *im.Client
}

// ResetProfile 管理端强制重置用户头像/昵称（更新 users + 同步 OpenIM）
func (h *AdminUserHandler) ResetProfile(c *gin.Context) {
	var req struct {
		AdminID string `json:"adminId"`
		Field   string `json:"field" binding:"required,oneof=avatar nickname"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	ctx := c.Request.Context()
	var publicID, curNickname, curAvatar string
	if err := h.Restrictions.DB.QueryRow(ctx,
		`SELECT COALESCE(public_id,''), COALESCE(nickname,''), COALESCE(avatar,'') FROM users WHERE id=$1::uuid`,
		c.Param("id")).Scan(&publicID, &curNickname, &curAvatar); err != nil {
		response.Fail(c, http.StatusBadRequest, "用户不存在")
		return
	}
	newNickname, newAvatar := curNickname, curAvatar
	switch req.Field {
	case "nickname":
		newNickname = "用户" + publicID
	case "avatar":
		newAvatar = ""
	}
	if _, err := h.Restrictions.DB.Exec(ctx,
		`UPDATE users SET nickname=$2, avatar=$3, updated_at=NOW() WHERE id=$1::uuid`,
		c.Param("id"), newNickname, newAvatar); err != nil {
		response.Fail(c, http.StatusInternalServerError, "更新用户资料失败")
		return
	}
	openIMID, err := im.UserIDFromBusinessID(c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "OpenIM ID 转换失败")
		return
	}
	if err := h.Client.UpdateUser(ctx, im.User{UserID: openIMID, Nickname: newNickname, FaceURL: newAvatar}); err != nil {
		response.Fail(c, http.StatusBadRequest, "OpenIM 资料同步失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// AdminMessageHandler 管理端消息操作（由管理后台经 /internal/admin 内部密钥调用）
type AdminMessageHandler struct {
	Client   *im.Client
	DB       *pgxpool.Pool
	IMAccess *repository.IMAccessRepo
}

// RecallMessage 管理端撤回消息：OpenIM 撤回 + messages 表标记
// 定位方式二选一：直接传 conversationId+seq，或传 clientMsgId（server 从 im_message_audit 反查）
func (h *AdminMessageHandler) RecallMessage(c *gin.Context) {
	var req struct {
		AdminID        string `json:"adminId"`
		Reason         string `json:"reason"`
		ClientMsgID    string `json:"clientMsgId"`    // OpenIM 消息 clientMsgID（前端消息数据普遍携带）
		ConversationID string `json:"conversationId"` // 或直接提供定位
		Seq            int64  `json:"seq"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	convID := req.ConversationID
	seq := req.Seq
	if convID == "" && req.ClientMsgID != "" {
		var found bool
		var err error
		convID, seq, found, err = h.IMAccess.FindAuditByClientMsgID(c.Request.Context(), req.ClientMsgID)
		if err != nil {
			response.Fail(c, http.StatusInternalServerError, "查询消息定位失败")
			return
		}
		if !found {
			response.Fail(c, http.StatusBadRequest, "未找到该消息的审计记录，无法定位撤回")
			return
		}
	}
	if convID == "" {
		response.Fail(c, http.StatusBadRequest, "conversationId 或 clientMsgId 必填")
		return
	}
	operatorIMID, err := im.UserIDFromBusinessID(req.AdminID)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "OpenIM ID 转换失败")
		return
	}
	if _, err := h.Client.RevokeMessage(c.Request.Context(), operatorIMID, convID, seq); err != nil {
		response.Fail(c, http.StatusBadRequest, "OpenIM 撤回失败："+err.Error())
		return
	}
	if _, err := h.DB.Exec(c.Request.Context(),
		`UPDATE messages SET recalled_at=NOW(), recalled_by=$2::uuid WHERE id=$1::uuid`,
		c.Param("id"), req.AdminID); err != nil {
		response.Fail(c, http.StatusInternalServerError, "更新消息标记失败")
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// SetRestriction 设置登录/发信限制（server 在登录/发消息时强制检查）
func (h *AdminUserHandler) SetRestriction(c *gin.Context) {
	var req struct {
		Type   string     `json:"type" binding:"required,oneof=login message"`
		Banned bool       `json:"banned"`
		Until  *time.Time `json:"until"`
		Reason string     `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Restrictions.SetRestriction(c.Request.Context(), c.Param("id"), req.Type, req.Banned, req.Until, req.Reason, ""); err != nil {
		response.Fail(c, http.StatusBadRequest, "设置失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// SetUserStatus 封禁/解封账号（banned 时强制下线）
func (h *AdminUserHandler) SetUserStatus(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=active banned cancelled"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.Restrictions.SetUserStatus(c.Request.Context(), c.Param("id"), req.Status, req.Reason, ""); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// RevokeSessions 强制用户全部设备下线
func (h *AdminUserHandler) RevokeSessions(c *gin.Context) {
	if err := h.Restrictions.RevokeSessions(c.Request.Context(), c.Param("id")); err != nil {
		response.Fail(c, http.StatusBadRequest, "操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// CancelForwardTask 管理端终止转发任务（走 server 队列逻辑）
func (h *AdminForwardHandler) CancelForwardTask(c *gin.Context) {
	var req struct {
		AdminID string `json:"adminId"`
		Reason  string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Reason == "" {
		response.Fail(c, http.StatusBadRequest, "reason 必填")
		return
	}
	task, err := h.Forward.Repo.GetTaskForWorker(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "任务不存在")
		return
	}
	if err := h.Forward.Cancel(c.Request.Context(), task.UserID, c.Param("id"), req.Reason); err != nil {
		response.Fail(c, http.StatusBadRequest, "终止失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// RetryForwardTask 管理端重试失败目标（走 server 队列逻辑）
func (h *AdminForwardHandler) RetryForwardTask(c *gin.Context) {
	task, err := h.Forward.Repo.GetTaskForWorker(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "任务不存在")
		return
	}
	n, err := h.Forward.Retry(c.Request.Context(), task.UserID, c.Param("id"), true, nil)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "重试失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"retried": n})
}

// DismissGroup 管理端解散群（复用 GroupRepo.DismissByAdmin，含 OpenIM 同步）
func (h *AdminGroupHandler) DismissGroup(c *gin.Context) {
	var req struct {
		AdminID string `json:"adminId" binding:"required"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.AdminID == "" {
		response.Fail(c, http.StatusBadRequest, "adminId 必填")
		return
	}
	if err := h.Repo.DismissByAdmin(c.Request.Context(), c.Param("id"), req.AdminID, req.Reason); err != nil {
		response.Fail(c, http.StatusBadRequest, "解散失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// MuteGroup 管理端全员禁言/解除（含 OpenIM 同步）
func (h *AdminGroupHandler) MuteGroup(c *gin.Context) {
	var req struct {
		AdminID string `json:"adminId" binding:"required"`
		Muted   bool   `json:"muted"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.AdminID == "" {
		response.Fail(c, http.StatusBadRequest, "adminId 必填")
		return
	}
	if err := h.Repo.UpdateGroupMuteByAdmin(c.Request.Context(), c.Param("id"), req.AdminID, req.Muted); err != nil {
		response.Fail(c, http.StatusBadRequest, "禁言操作失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// SetAddFriend 管理端设置群内互加好友开关（含 OpenIM 同步）
func (h *AdminGroupHandler) SetAddFriend(c *gin.Context) {
	var req struct {
		AdminID string `json:"adminId" binding:"required"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.AdminID == "" {
		response.Fail(c, http.StatusBadRequest, "adminId 必填")
		return
	}
	if err := h.Repo.UpdateSettingsByAdmin(c.Request.Context(), c.Param("id"), req.AdminID, &req.Enabled); err != nil {
		response.Fail(c, http.StatusBadRequest, "设置失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

func (h *AdminGroupHandler) UpdateMemberLimit(c *gin.Context) {
	var req struct {
		GroupID    string `json:"groupId" binding:"required"`
		AdminID    string `json:"adminId" binding:"required"`
		MaxMembers int    `json:"maxMembers" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "groupId、adminId、maxMembers、reason 必填")
		return
	}
	if err := h.Repo.UpdateMemberLimitByAdmin(c.Request.Context(), req.GroupID, req.AdminID, req.MaxMembers, req.Reason); err != nil {
		response.Fail(c, http.StatusBadRequest, "设置失败："+err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}
