package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"im-app-admin/internal/config"
	"im-app-admin/internal/db"
	"im-app-admin/internal/handler"
	"im-app-admin/internal/middleware"
	"im-app-admin/internal/repository"
	"im-app-admin/internal/service"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	cfg := config.Load()
	if cfg.AdminJWTSecret == "im-admin-dev-secret-change-me" {
		log.Println("WARN: ADMIN_JWT_SECRET 使用默认开发密钥，生产环境必须设置独立密钥")
	}

	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	migrationsDir, _ := filepath.Abs("migrations")
	if err := db.RunMigrationsDir(context.Background(), pool, migrationsDir); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Println("migrations applied")

	authRepo := &repository.AuthRepo{DB: pool}
	rbacRepo := &repository.RBACRepo{DB: pool}
	auditRepo := &repository.AuditRepo{DB: pool}

	// 一次性初始化超级管理员（密码来自环境变量，不写死演示密码）
	if cfg.BootstrapPassword != "" {
		hash, _ := bcrypt.GenerateFromPassword([]byte(cfg.BootstrapPassword), bcrypt.DefaultCost)
		if err := rbacRepo.BootstrapAdmin(context.Background(), cfg.BootstrapUsername, string(hash)); err != nil {
			log.Printf("bootstrap admin: %v", err)
		} else {
			log.Printf("super admin ensured (username=%s)", cfg.BootstrapUsername)
		}
	} else {
		log.Println("未设置 ADMIN_BOOTSTRAP_PASSWORD，跳过首个超级管理员初始化")
	}

	authSvc := &service.AuthService{
		Auth:       authRepo,
		Rbac:       rbacRepo,
		Audit:      auditRepo,
		Secret:     cfg.AdminJWTSecret,
		Issuer:     cfg.JWTIssuer,
		Audience:   cfg.JWTAudience,
		AccessTTL:  cfg.AccessTokenTTL,
		RefreshTTL: cfg.RefreshTokenTTL,
		MFATTL:     5 * time.Minute,
	}
	rbacSvc := &service.RBACService{Rbac: rbacRepo, Auth: authRepo, Audit: auditRepo}

	dataRepo := &repository.DataRepo{DB: pool}
	opsRepo := &repository.OpsRepo{DB: pool}
	dataSvc := &service.DataService{Repo: dataRepo}
	opsSvc := &service.OpsService{Repo: opsRepo}

	dataH := &handler.DataHandler{Data: dataSvc}
	opsH := &handler.OpsHandler{Svc: opsSvc}

	authH := &handler.AuthHandler{
		Svc:     authSvc,
		Limiter: middleware.NewLoginLimiter(cfg.LoginFailThreshold, cfg.LoginLockMinutes),
	}
	rbacH := &handler.RBACHandler{Svc: rbacSvc}
	metaH := &handler.MetaHandler{Version: "1.0.0", Commit: "dev", BuildTime: time.Now().UTC().Format(time.RFC3339)}

	r := gin.New()
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
		v1.GET("/health", metaH.Health)
		v1.GET("/meta", middleware.RequirePermission(rbacRepo, "admin.login"), metaH.Meta)

		// 模块 01：登录 / MFA 挑战（公共）
		v1.POST("/auth/login", authH.Login)
		v1.POST("/auth/mfa/verify", authH.MFAVerify)

		// 已登录区：认证 + 审计
		auth := v1.Group("")
		auth.Use(middleware.AuthRequired(cfg.AdminJWTSecret, cfg.JWTIssuer, cfg.JWTAudience))
		auth.Use(middleware.Audit(auditRepo))
		{
			auth.POST("/auth/token/refresh", authH.Refresh)
			auth.POST("/auth/logout", authH.Logout)
			auth.POST("/auth/logout-all", authH.LogoutAll)
			auth.GET("/me", authH.Me)
			auth.PUT("/me/password", authH.ChangePassword)
			auth.GET("/me/mfa", authH.MFAStatus)
			auth.POST("/me/mfa/setup", authH.MFASetup)
			auth.POST("/me/mfa/disable", authH.MFADisable)

			// 管理员与角色
			auth.GET("/admins", middleware.RequirePermission(rbacRepo, "admins.read"), rbacH.ListAdmins)
			auth.POST("/admins", middleware.RequirePermission(rbacRepo, "admins.write"), rbacH.CreateAdmin)
			auth.PATCH("/admins/:id", middleware.RequirePermission(rbacRepo, "admins.write"), rbacH.UpdateAdmin)
			auth.PUT("/admins/:id/status", middleware.RequirePermission(rbacRepo, "admins.status"), rbacH.SetAdminStatus)
			auth.POST("/admins/:id/mfa/reset", middleware.RequirePermission(rbacRepo, "admins.security"), rbacH.ResetMFA)
			auth.GET("/roles", middleware.RequirePermission(rbacRepo, "roles.read"), rbacH.ListRoles)
			auth.POST("/roles", middleware.RequirePermission(rbacRepo, "roles.write"), rbacH.CreateRole)
			auth.PUT("/roles/:id", middleware.RequirePermission(rbacRepo, "roles.write"), rbacH.UpdateRole)
			auth.DELETE("/roles/:id", middleware.RequirePermission(rbacRepo, "roles.write"), rbacH.DeleteRole)
			auth.GET("/permissions", middleware.RequirePermission(rbacRepo, "roles.read"), rbacH.ListPermissions)

			// 模块 10：审计
			auth.GET("/audit-logs", middleware.RequirePermission(rbacRepo, "audit.read"), rbacH.ListAuditLogs)
			auth.GET("/audit-logs/:id", middleware.RequirePermission(rbacRepo, "audit.read"), rbacH.GetAuditLog)
			auth.GET("/admin-login-logs", middleware.RequirePermission(rbacRepo, "security.logs.read"), rbacH.ListLoginLogs)

			// 模块 02：工作台
			auth.GET("/dashboard/overview", middleware.RequirePermission(rbacRepo, "dashboard.read"), opsH.DashboardOverview)
			auth.GET("/dashboard/trends", middleware.RequirePermission(rbacRepo, "dashboard.read"), opsH.DashboardTrends)
			auth.GET("/dashboard/todos", middleware.RequirePermission(rbacRepo, "dashboard.read"), opsH.DashboardTodos)

			// 模块 03：用户管理
			auth.GET("/users", middleware.RequirePermission(rbacRepo, "users.read"), dataH.ListUsers)
			auth.GET("/users/:id", middleware.RequirePermission(rbacRepo, "users.read"), dataH.GetUser)
			auth.POST("/users/:id/phone/reveal", middleware.RequirePermission(rbacRepo, "users.phone.reveal"), dataH.RevealPhone)
			auth.GET("/users/:id/groups", middleware.RequirePermission(rbacRepo, "users.groups.read"), dataH.ListUserGroups)
			auth.GET("/users/:id/reports", middleware.RequirePermission(rbacRepo, "reports.read"), dataH.ListUserReports)
			auth.GET("/users/:id/forward-tasks", middleware.RequirePermission(rbacRepo, "forward.read"), dataH.ListUserForwardTasks)
			auth.PUT("/users/:id/login-restriction", middleware.RequirePermission(rbacRepo, "users.restrict.login"), dataH.SetLoginRestriction)
			auth.PUT("/users/:id/message-restriction", middleware.RequirePermission(rbacRepo, "users.restrict.message"), dataH.SetMessageRestriction)
			auth.PUT("/users/:id/ban", middleware.RequirePermission(rbacRepo, "users.ban"), dataH.BanUser)
			auth.POST("/users/:id/sessions/revoke", middleware.RequirePermission(rbacRepo, "users.sessions.revoke"), dataH.RevokeSessions)

			// 模块 04：群组管理
			auth.GET("/groups", middleware.RequirePermission(rbacRepo, "groups.read"), dataH.ListGroups)
			auth.GET("/groups/:id", middleware.RequirePermission(rbacRepo, "groups.read"), dataH.GetGroup)
			auth.GET("/groups/:id/members", middleware.RequirePermission(rbacRepo, "groups.members.read"), dataH.ListGroupMembers)
			auth.GET("/groups/:id/reports", middleware.RequirePermission(rbacRepo, "reports.read"), dataH.ListGroupReports)
			auth.PUT("/groups/:id/mute-all", middleware.RequirePermission(rbacRepo, "groups.mute"), dataH.SetGroupMuteAll)
			auth.PUT("/groups/:id/member-add-friend", middleware.RequirePermission(rbacRepo, "groups.settings"), dataH.SetGroupAddFriend)
			auth.POST("/groups/:id/dissolve", middleware.RequirePermission(rbacRepo, "groups.dissolve"), dataH.DissolveGroup)
			auth.GET("/groups/:id/recall-logs", middleware.RequirePermission(rbacRepo, "messages.audit.read"), dataH.ListGroupRecallLogs)
			auth.POST("/groups/:id/messages/:messageId/recall", middleware.RequirePermission(rbacRepo, "messages.recall.admin"), dataH.RecallMessage)

			// 模块 05：举报与内容处置
			auth.GET("/reports", middleware.RequirePermission(rbacRepo, "reports.read"), dataH.ListReports)
			auth.GET("/reports/:id", middleware.RequirePermission(rbacRepo, "reports.read"), dataH.GetReport)
			auth.POST("/reports/:id/assign", middleware.RequirePermission(rbacRepo, "reports.assign"), dataH.AssignReport)
			auth.POST("/reports/:id/start", middleware.RequirePermission(rbacRepo, "reports.handle"), dataH.StartReport)
			auth.POST("/reports/:id/notes", middleware.RequirePermission(rbacRepo, "reports.handle"), dataH.AddReportNote)
			auth.POST("/reports/:id/resolve", middleware.RequirePermission(rbacRepo, "reports.resolve"), dataH.ResolveReport)
			auth.POST("/reports/:id/reject", middleware.RequirePermission(rbacRepo, "reports.resolve"), dataH.RejectReport)
			auth.POST("/reports/:id/reopen", middleware.RequirePermission(rbacRepo, "reports.reopen"), dataH.ReopenReport)
			auth.GET("/reports/:id/actions", middleware.RequirePermission(rbacRepo, "reports.read"), dataH.ListReportActions)

			// 模块 06：转发/群发与风控
			auth.GET("/forward-tasks", middleware.RequirePermission(rbacRepo, "forward.read"), opsH.ListForwardTasks)
			auth.GET("/forward-tasks/:id", middleware.RequirePermission(rbacRepo, "forward.read"), opsH.GetForwardTask)
			auth.GET("/forward-tasks/:id/targets", middleware.RequirePermission(rbacRepo, "forward.targets.read"), opsH.ListForwardTargets)
			auth.GET("/forward-tasks/:id/failures", middleware.RequirePermission(rbacRepo, "forward.read"), opsH.ForwardFailures)
			auth.POST("/forward-tasks/:id/cancel", middleware.RequirePermission(rbacRepo, "forward.cancel"), opsH.CancelForwardTask)
			auth.POST("/forward-tasks/:id/retry-failed", middleware.RequirePermission(rbacRepo, "forward.retry"), opsH.RetryForwardTask)
			auth.GET("/forward-limits/users/:userId", middleware.RequirePermission(rbacRepo, "forward.limits.read"), opsH.GetForwardUserLimit)
			auth.PUT("/forward-limits/users/:userId", middleware.RequirePermission(rbacRepo, "forward.limits.write"), opsH.SetForwardUserLimit)
			auth.GET("/forward-settings", middleware.RequirePermission(rbacRepo, "forward.settings.read"), opsH.GetForwardSettings)
			auth.PUT("/forward-settings", middleware.RequirePermission(rbacRepo, "forward.settings.write"), opsH.SetForwardSettings)

			// 模块 07：国家与短信运营
			auth.GET("/countries", middleware.RequirePermission(rbacRepo, "countries.read"), opsH.ListCountries)
			auth.POST("/countries", middleware.RequirePermission(rbacRepo, "countries.write"), opsH.CreateCountry)
			auth.PUT("/countries/:code/status", middleware.RequirePermission(rbacRepo, "countries.status"), opsH.UpdateCountryStatus)
			auth.GET("/sms/logs", middleware.RequirePermission(rbacRepo, "sms.logs.read"), opsH.ListSmsLogs)
			auth.GET("/sms/logs/:id", middleware.RequirePermission(rbacRepo, "sms.logs.read"), opsH.GetSmsLog)
			auth.GET("/sms/statistics", middleware.RequirePermission(rbacRepo, "sms.statistics.read"), opsH.SmsStatistics)
			auth.GET("/sms/providers/health", middleware.RequirePermission(rbacRepo, "sms.providers.read"), opsH.ProviderHealth)

			// 模块 08：APP 与公共配置
			auth.GET("/app-versions", middleware.RequirePermission(rbacRepo, "app-versions.read"), opsH.ListAppVersions)
			auth.POST("/app-versions", middleware.RequirePermission(rbacRepo, "app-versions.write"), opsH.CreateAppVersion)
			auth.PUT("/app-versions/:id", middleware.RequirePermission(rbacRepo, "app-versions.write"), opsH.UpdateAppVersion)
			auth.PUT("/app-versions/:id/status", middleware.RequirePermission(rbacRepo, "app-versions.write"), opsH.SetAppVersionStatus)
			auth.GET("/legal-documents", middleware.RequirePermission(rbacRepo, "legal.read"), opsH.ListLegalDocuments)
			auth.POST("/legal-documents", middleware.RequirePermission(rbacRepo, "legal.write"), opsH.CreateLegalDocument)
			auth.POST("/legal-documents/:id/publish", middleware.RequirePermission(rbacRepo, "legal.write"), opsH.PublishLegalDocument)
			auth.GET("/report-reasons", middleware.RequirePermission(rbacRepo, "report-reasons.read"), opsH.ListReportReasons)
			auth.POST("/report-reasons", middleware.RequirePermission(rbacRepo, "report-reasons.write"), opsH.CreateReportReason)
			auth.PUT("/report-reasons/:id", middleware.RequirePermission(rbacRepo, "report-reasons.write"), opsH.UpdateReportReason)
			auth.PUT("/report-reasons/:id/status", middleware.RequirePermission(rbacRepo, "report-reasons.write"), opsH.SetReportReasonStatus)
			auth.GET("/system-limits", middleware.RequirePermission(rbacRepo, "system-limits.read"), opsH.GetSystemLimits)
			auth.PUT("/system-limits", middleware.RequirePermission(rbacRepo, "system-limits.write"), opsH.SaveSystemLimits)
			auth.POST("/system-limits/publish", middleware.RequirePermission(rbacRepo, "system-limits.write"), opsH.PublishSystemLimits)

			// 模块 09：敏感词与资料审核
			auth.GET("/sensitive-words", middleware.RequirePermission(rbacRepo, "moderation.words.read"), opsH.ListSensitiveWords)
			auth.POST("/sensitive-words", middleware.RequirePermission(rbacRepo, "moderation.words.write"), opsH.CreateSensitiveWord)
			auth.POST("/sensitive-words/import", middleware.RequirePermission(rbacRepo, "moderation.words.import"), opsH.ImportSensitiveWords)
			auth.PUT("/sensitive-words/:id", middleware.RequirePermission(rbacRepo, "moderation.words.write"), opsH.UpdateSensitiveWord)
			auth.PUT("/sensitive-words/:id/status", middleware.RequirePermission(rbacRepo, "moderation.words.write"), opsH.SetSensitiveWordStatus)
			auth.GET("/moderation/hits", middleware.RequirePermission(rbacRepo, "moderation.hits.read"), opsH.ListModerationHits)
			auth.GET("/moderation/profiles", middleware.RequirePermission(rbacRepo, "moderation.profiles.read"), opsH.ListProfileModerations)
			auth.POST("/moderation/profiles/:userId/reject", middleware.RequirePermission(rbacRepo, "moderation.profiles.handle"), opsH.RejectProfile)
			auth.POST("/moderation/profiles/:userId/restore", middleware.RequirePermission(rbacRepo, "moderation.profiles.handle"), opsH.RestoreProfile)

			// 模块 10：运行错误与导出
			auth.GET("/system/errors", middleware.RequirePermission(rbacRepo, "system.errors.read"), opsH.ListErrorEvents)
			auth.GET("/system/errors/:id", middleware.RequirePermission(rbacRepo, "system.errors.read"), opsH.GetErrorEvent)
			auth.POST("/exports", middleware.RequirePermission(rbacRepo, "exports.create"), opsH.CreateExport)
			auth.GET("/exports", middleware.RequirePermission(rbacRepo, "exports.read.all"), opsH.ListExports)
		}
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Admin API listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
