package server

import (
	"im-app-admin/internal/config"
	"im-app-admin/internal/handler"
	"im-app-admin/internal/middleware"
	"im-app-admin/internal/repository"

	"github.com/gin-gonic/gin"
)

// Deps 构建路由所需依赖（handler 已初始化）
type Deps struct {
	Cfg       config.Config
	RbacRepo  *repository.RBACRepo
	AuditRepo *repository.AuditRepo
	AuthH     *handler.AuthHandler
	RBACH     *handler.RBACHandler
	DataH     *handler.DataHandler
	OpsH      *handler.OpsHandler
	MetaH     *handler.MetaHandler
}

// BuildRouter 构建管理后台路由（含中间件链与全部模块路由）
func BuildRouter(d Deps) *gin.Engine {
	cfg := d.Cfg
	rbacRepo := d.RbacRepo
	auditRepo := d.AuditRepo

	r := gin.New()
	// 访问日志：记录每个请求的方法、路径、状态码与耗时（含 4xx/5xx，便于在控制台定位）
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(middleware.RequestID(cfg))
	r.Use(middleware.CORS(cfg.CORSOrigins))
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.BodyLimit(cfg.MaxBodyBytes))
	if len(cfg.TrustedProxies) > 0 {
		_ = r.SetTrustedProxies(cfg.TrustedProxies)
	} else {
		_ = r.SetTrustedProxies(nil)
	}

	v1 := r.Group("/api/admin/v1")
	{
		// 模块 00：健康与元信息
		v1.GET("/health", d.MetaH.Health)
		v1.GET("/meta", middleware.AuthRequired(cfg.AdminJWTSecret, cfg.JWTIssuer, cfg.JWTAudience), middleware.RequirePermission(rbacRepo, "admin.login"), d.MetaH.Meta)

		// 模块 01：登录 / MFA 挑战（公共）
		v1.POST("/auth/login", d.AuthH.Login)
		v1.POST("/auth/mfa/verify", d.AuthH.MFAVerify)

		// 已登录区：认证 + 审计
		auth := v1.Group("")
		auth.Use(middleware.AuthRequired(cfg.AdminJWTSecret, cfg.JWTIssuer, cfg.JWTAudience))
		auth.Use(middleware.Audit(auditRepo))
		{
			auth.POST("/auth/token/refresh", d.AuthH.Refresh)
			auth.POST("/auth/logout", d.AuthH.Logout)
			auth.POST("/auth/logout-all", d.AuthH.LogoutAll)
			auth.GET("/me", d.AuthH.Me)
			auth.PUT("/me/password", d.AuthH.ChangePassword)
			auth.GET("/me/mfa", d.AuthH.MFAStatus)
			auth.POST("/me/mfa/setup", d.AuthH.MFASetup)
			auth.POST("/me/mfa/disable", d.AuthH.MFADisable)

			// 管理员与角色
			auth.GET("/admins", middleware.RequirePermission(rbacRepo, "admins.read"), d.RBACH.ListAdmins)
			auth.POST("/admins", middleware.RequirePermission(rbacRepo, "admins.write"), d.RBACH.CreateAdmin)
			auth.PATCH("/admins/:id", middleware.RequirePermission(rbacRepo, "admins.write"), d.RBACH.UpdateAdmin)
			auth.PUT("/admins/:id/status", middleware.RequirePermission(rbacRepo, "admins.status"), d.RBACH.SetAdminStatus)
			auth.POST("/admins/:id/mfa/reset", middleware.RequirePermission(rbacRepo, "admins.security"), d.RBACH.ResetMFA)
			auth.GET("/roles", middleware.RequirePermission(rbacRepo, "roles.read"), d.RBACH.ListRoles)
			auth.POST("/roles", middleware.RequirePermission(rbacRepo, "roles.write"), d.RBACH.CreateRole)
			auth.PUT("/roles/:id", middleware.RequirePermission(rbacRepo, "roles.write"), d.RBACH.UpdateRole)
			auth.DELETE("/roles/:id", middleware.RequirePermission(rbacRepo, "roles.write"), d.RBACH.DeleteRole)
			auth.GET("/permissions", middleware.RequirePermission(rbacRepo, "roles.read"), d.RBACH.ListPermissions)

			// 模块 10：审计
			auth.GET("/audit-logs", middleware.RequirePermission(rbacRepo, "audit.read"), d.RBACH.ListAuditLogs)
			auth.GET("/audit-logs/:id", middleware.RequirePermission(rbacRepo, "audit.read"), d.RBACH.GetAuditLog)
			auth.GET("/admin-login-logs", middleware.RequirePermission(rbacRepo, "security.logs.read"), d.RBACH.ListLoginLogs)

			// 模块 02：工作台
			auth.GET("/dashboard/overview", middleware.RequirePermission(rbacRepo, "dashboard.read"), d.OpsH.DashboardOverview)
			auth.GET("/dashboard/trends", middleware.RequirePermission(rbacRepo, "dashboard.read"), d.OpsH.DashboardTrends)
			auth.GET("/dashboard/todos", middleware.RequirePermission(rbacRepo, "dashboard.read"), d.OpsH.DashboardTodos)

			// 模块 03：用户管理
			auth.GET("/users", middleware.RequirePermission(rbacRepo, "users.read"), d.DataH.ListUsers)
			auth.GET("/users/:id", middleware.RequirePermission(rbacRepo, "users.read"), d.DataH.GetUser)
			auth.POST("/users/:id/phone/reveal", middleware.RequirePermission(rbacRepo, "users.phone.reveal"), d.DataH.RevealPhone)
			auth.GET("/users/:id/groups", middleware.RequirePermission(rbacRepo, "users.groups.read"), d.DataH.ListUserGroups)
			auth.GET("/users/:id/reports", middleware.RequirePermission(rbacRepo, "reports.read"), d.DataH.ListUserReports)
			auth.GET("/users/:id/forward-tasks", middleware.RequirePermission(rbacRepo, "forward.read"), d.DataH.ListUserForwardTasks)
			auth.PUT("/users/:id/login-restriction", middleware.RequirePermission(rbacRepo, "users.restrict.login"), d.DataH.SetLoginRestriction)
			auth.PUT("/users/:id/message-restriction", middleware.RequirePermission(rbacRepo, "users.restrict.message"), d.DataH.SetMessageRestriction)
			auth.PUT("/users/:id/ban", middleware.RequirePermission(rbacRepo, "users.ban"), d.DataH.BanUser)
			auth.POST("/users/:id/sessions/revoke", middleware.RequirePermission(rbacRepo, "users.sessions.revoke"), d.DataH.RevokeSessions)

			// 模块 04：群组管理
			auth.GET("/groups", middleware.RequirePermission(rbacRepo, "groups.read"), d.DataH.ListGroups)
			auth.GET("/groups/:id", middleware.RequirePermission(rbacRepo, "groups.read"), d.DataH.GetGroup)
			auth.GET("/groups/:id/members", middleware.RequirePermission(rbacRepo, "groups.members.read"), d.DataH.ListGroupMembers)
			auth.GET("/groups/:id/reports", middleware.RequirePermission(rbacRepo, "reports.read"), d.DataH.ListGroupReports)
			auth.PUT("/groups/:id/mute-all", middleware.RequirePermission(rbacRepo, "groups.mute"), d.DataH.SetGroupMuteAll)
			auth.PUT("/groups/:id/member-add-friend", middleware.RequirePermission(rbacRepo, "groups.settings"), d.DataH.SetGroupAddFriend)
			auth.POST("/groups/:id/dissolve", middleware.RequirePermission(rbacRepo, "groups.dissolve"), d.DataH.DissolveGroup)
			auth.GET("/groups/:id/recall-logs", middleware.RequirePermission(rbacRepo, "messages.audit.read"), d.DataH.ListGroupRecallLogs)
			auth.POST("/groups/:id/messages/:messageId/recall", middleware.RequirePermission(rbacRepo, "messages.recall.admin"), d.DataH.RecallMessage)

			// 模块 05：举报与内容处置
			auth.GET("/reports", middleware.RequirePermission(rbacRepo, "reports.read"), d.DataH.ListReports)
			auth.GET("/reports/:id", middleware.RequirePermission(rbacRepo, "reports.read"), d.DataH.GetReport)
			auth.POST("/reports/:id/assign", middleware.RequirePermission(rbacRepo, "reports.assign"), d.DataH.AssignReport)
			auth.POST("/reports/:id/start", middleware.RequirePermission(rbacRepo, "reports.handle"), d.DataH.StartReport)
			auth.POST("/reports/:id/notes", middleware.RequirePermission(rbacRepo, "reports.handle"), d.DataH.AddReportNote)
			auth.POST("/reports/:id/resolve", middleware.RequirePermission(rbacRepo, "reports.resolve"), d.DataH.ResolveReport)
			auth.POST("/reports/:id/reject", middleware.RequirePermission(rbacRepo, "reports.resolve"), d.DataH.RejectReport)
			auth.POST("/reports/:id/reopen", middleware.RequirePermission(rbacRepo, "reports.reopen"), d.DataH.ReopenReport)
			auth.GET("/reports/:id/actions", middleware.RequirePermission(rbacRepo, "reports.read"), d.DataH.ListReportActions)

			// 模块 06：转发/群发与风控
			auth.GET("/forward-tasks", middleware.RequirePermission(rbacRepo, "forward.read"), d.OpsH.ListForwardTasks)
			auth.GET("/forward-tasks/:id", middleware.RequirePermission(rbacRepo, "forward.read"), d.OpsH.GetForwardTask)
			auth.GET("/forward-tasks/:id/targets", middleware.RequirePermission(rbacRepo, "forward.targets.read"), d.OpsH.ListForwardTargets)
			auth.GET("/forward-tasks/:id/failures", middleware.RequirePermission(rbacRepo, "forward.read"), d.OpsH.ForwardFailures)
			auth.POST("/forward-tasks/:id/cancel", middleware.RequirePermission(rbacRepo, "forward.cancel"), d.OpsH.CancelForwardTask)
			auth.POST("/forward-tasks/:id/retry-failed", middleware.RequirePermission(rbacRepo, "forward.retry"), d.OpsH.RetryForwardTask)
			auth.GET("/forward-limits/users/:userId", middleware.RequirePermission(rbacRepo, "forward.limits.read"), d.OpsH.GetForwardUserLimit)
			auth.PUT("/forward-limits/users/:userId", middleware.RequirePermission(rbacRepo, "forward.limits.write"), d.OpsH.SetForwardUserLimit)
			auth.GET("/forward-settings", middleware.RequirePermission(rbacRepo, "forward.settings.read"), d.OpsH.GetForwardSettings)
			auth.PUT("/forward-settings", middleware.RequirePermission(rbacRepo, "forward.settings.write"), d.OpsH.SetForwardSettings)

			// 模块 07：国家与短信运营
			auth.GET("/countries", middleware.RequirePermission(rbacRepo, "countries.read"), d.OpsH.ListCountries)
			auth.POST("/countries", middleware.RequirePermission(rbacRepo, "countries.write"), d.OpsH.CreateCountry)
			auth.PUT("/countries/:code/status", middleware.RequirePermission(rbacRepo, "countries.status"), d.OpsH.UpdateCountryStatus)
			auth.GET("/sms/logs", middleware.RequirePermission(rbacRepo, "sms.logs.read"), d.OpsH.ListSmsLogs)
			auth.GET("/sms/logs/:id", middleware.RequirePermission(rbacRepo, "sms.logs.read"), d.OpsH.GetSmsLog)
			auth.GET("/sms/statistics", middleware.RequirePermission(rbacRepo, "sms.statistics.read"), d.OpsH.SmsStatistics)
			auth.GET("/sms/providers/health", middleware.RequirePermission(rbacRepo, "sms.providers.read"), d.OpsH.ProviderHealth)

			// 模块 08：APP 与公共配置
			auth.GET("/app-versions", middleware.RequirePermission(rbacRepo, "app-versions.read"), d.OpsH.ListAppVersions)
			auth.POST("/app-versions", middleware.RequirePermission(rbacRepo, "app-versions.write"), d.OpsH.CreateAppVersion)
			auth.PUT("/app-versions/:id", middleware.RequirePermission(rbacRepo, "app-versions.write"), d.OpsH.UpdateAppVersion)
			auth.PUT("/app-versions/:id/status", middleware.RequirePermission(rbacRepo, "app-versions.write"), d.OpsH.SetAppVersionStatus)
			auth.GET("/legal-documents", middleware.RequirePermission(rbacRepo, "legal.read"), d.OpsH.ListLegalDocuments)
			auth.POST("/legal-documents", middleware.RequirePermission(rbacRepo, "legal.write"), d.OpsH.CreateLegalDocument)
			auth.POST("/legal-documents/:id/publish", middleware.RequirePermission(rbacRepo, "legal.write"), d.OpsH.PublishLegalDocument)
			auth.GET("/report-reasons", middleware.RequirePermission(rbacRepo, "report-reasons.read"), d.OpsH.ListReportReasons)
			auth.POST("/report-reasons", middleware.RequirePermission(rbacRepo, "report-reasons.write"), d.OpsH.CreateReportReason)
			auth.PUT("/report-reasons/:id", middleware.RequirePermission(rbacRepo, "report-reasons.write"), d.OpsH.UpdateReportReason)
			auth.PUT("/report-reasons/:id/status", middleware.RequirePermission(rbacRepo, "report-reasons.write"), d.OpsH.SetReportReasonStatus)
			auth.GET("/system-limits", middleware.RequirePermission(rbacRepo, "system-limits.read"), d.OpsH.GetSystemLimits)
			auth.PUT("/system-limits", middleware.RequirePermission(rbacRepo, "system-limits.write"), d.OpsH.SaveSystemLimits)
			auth.POST("/system-limits/publish", middleware.RequirePermission(rbacRepo, "system-limits.write"), d.OpsH.PublishSystemLimits)

			// 模块 09：敏感词与资料审核
			auth.GET("/sensitive-words", middleware.RequirePermission(rbacRepo, "moderation.words.read"), d.OpsH.ListSensitiveWords)
			auth.POST("/sensitive-words", middleware.RequirePermission(rbacRepo, "moderation.words.write"), d.OpsH.CreateSensitiveWord)
			auth.POST("/sensitive-words/import", middleware.RequirePermission(rbacRepo, "moderation.words.import"), d.OpsH.ImportSensitiveWords)
			auth.PUT("/sensitive-words/:id", middleware.RequirePermission(rbacRepo, "moderation.words.write"), d.OpsH.UpdateSensitiveWord)
			auth.PUT("/sensitive-words/:id/status", middleware.RequirePermission(rbacRepo, "moderation.words.write"), d.OpsH.SetSensitiveWordStatus)
			auth.GET("/moderation/hits", middleware.RequirePermission(rbacRepo, "moderation.hits.read"), d.OpsH.ListModerationHits)
			auth.GET("/moderation/profiles", middleware.RequirePermission(rbacRepo, "moderation.profiles.read"), d.OpsH.ListProfileModerations)
			auth.POST("/moderation/profiles/:userId/approve", middleware.RequirePermission(rbacRepo, "moderation.profiles.handle"), d.OpsH.ApproveProfile)
			auth.POST("/moderation/profiles/:userId/reject", middleware.RequirePermission(rbacRepo, "moderation.profiles.handle"), d.OpsH.RejectProfile)
			auth.POST("/moderation/profiles/:userId/restore", middleware.RequirePermission(rbacRepo, "moderation.profiles.handle"), d.OpsH.RestoreProfile)

			// 模块 10：运行错误与导出
			auth.GET("/system/errors", middleware.RequirePermission(rbacRepo, "system.errors.read"), d.OpsH.ListErrorEvents)
			auth.GET("/system/errors/:id", middleware.RequirePermission(rbacRepo, "system.errors.read"), d.OpsH.GetErrorEvent)
			auth.POST("/exports", middleware.RequirePermission(rbacRepo, "exports.create"), d.OpsH.CreateExport)
			auth.GET("/exports", middleware.RequirePermission(rbacRepo, "exports.read.all"), d.OpsH.ListExports)
		}
	}

	return r
}
