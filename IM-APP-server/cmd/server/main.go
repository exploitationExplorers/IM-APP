package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"im-app-server/internal/config"
	"im-app-server/internal/db"
	"im-app-server/internal/handler"
	"im-app-server/internal/im"
	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
	"im-app-server/internal/ws"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	migrationsDir := filepath.Join("migrations")
	if err := db.RunMigrationsDir(context.Background(), pool, migrationsDir); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if err := db.RequireColumns(context.Background(), pool, map[string][]string{
		"report_reasons":       {"id", "target_type", "reason", "language", "sort_order", "status"},
		"reports":              {"id", "report_no", "reporter_id", "target_type", "target_id", "reason_id", "reason_text", "description", "status", "created_at", "updated_at"},
		"report_files":         {"id", "report_id", "file_id", "file_url", "content_type", "created_at"},
		"forward_tasks":        {"id", "user_id", "source_snapshot", "target_count", "done_count", "success_count", "failed_count", "skipped_count", "cancelled_count", "status"},
		"forward_task_targets": {"id", "task_id", "user_id", "status", "attempts", "next_retry_at", "locked_by", "locked_until"},
		"forward_kafka_outbox": {"id", "task_id", "status", "attempts", "next_attempt_at", "locked_by", "locked_until"},
	}); err != nil {
		log.Fatalf("schema check: %v; required migrations: 017_app_reports.sql, 021_forward_queue.sql", err)
	}
	log.Println("migrations applied")

	if cfg.SeedDemo {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := db.SeedDemo(ctx, pool); err != nil {
			cancel()
			log.Fatalf("seed: %v", err)
		}
		cancel()
	}

	var hub *ws.Hub
	if cfg.LegacyChatEnabled {
		hub = ws.NewHub(cfg.JWTSecret)
	}

	redisClient, err := infra.NewRedis(cfg.RedisURL)
	if err != nil {
		log.Printf("redis disabled: %v", err)
		redisClient = &infra.Redis{}
	} else if redisClient.Available() {
		log.Println("redis connected")
		defer redisClient.Close()
	}

	minioClient, err := infra.NewMinIO(cfg.MinIO)
	if err != nil {
		log.Printf("minio disabled: %v", err)
		minioClient = &infra.MinIO{}
	} else if minioClient.Available() {
		log.Println("minio connected")
	}

	imClient := im.NewClient(cfg.OpenIM)
	kafkaQueue := infra.NewKafka(cfg.Kafka.Brokers, cfg.Kafka.Topic, cfg.Kafka.GroupID)
	defer kafkaQueue.Close()

	userRepo := &repository.UserRepo{DB: pool}
	contactRepo := &repository.ContactRepo{DB: pool}
	contactTagRepo := &repository.ContactTagRepo{DB: pool}
	privacyRepo := &repository.PrivacyRepo{DB: pool}
	chatRepo := &repository.ChatRepo{DB: pool}
	fileRepo := &repository.FileRepo{DB: pool}
	imOutboxRepo := &repository.IMSyncOutboxRepo{DB: pool}
	imAccessRepo := &repository.IMAccessRepo{DB: pool}
	reportRepo := &repository.ReportRepo{DB: pool}
	forwardRepo := &repository.ForwardRepo{DB: pool}

	groupRepo := &repository.GroupRepo{DB: pool, LegacyChatEnabled: cfg.LegacyChatEnabled}

	userSvc := &service.UserService{Users: userRepo, Files: fileRepo, Contacts: contactRepo, Privacy: privacyRepo}
	imSvc := &service.IMService{
		Client: imClient, Users: userRepo, Groups: groupRepo, Access: imAccessRepo, Config: cfg.OpenIM, TokenCache: redisClient,
	}
	imAdminSvc := &service.IMAdminService{
		Client: imClient, Users: userRepo, Groups: groupRepo, Access: imAccessRepo, Outbox: imOutboxRepo,
	}
	contactSvc := &service.ContactService{Contacts: contactRepo, Groups: groupRepo, Users: userRepo, Tags: contactTagRepo, Privacy: privacyRepo}
	chatSvc := &service.ChatService{Chat: chatRepo}
	if cfg.LegacyChatEnabled {
		chatSvc.Hub = hub
	}
	favRepo := &repository.FavoriteRepo{DB: pool}
	favSvc := &service.FavoriteService{Fav: favRepo}
	countryRepo := &repository.CountryRepo{DB: pool}
	groupSvc := &service.GroupService{Groups: groupRepo, Files: fileRepo}
	forwardSvc := &service.ForwardService{Repo: forwardRepo, Client: imClient, Kafka: kafkaQueue}
	reportSvc := &service.ReportService{Reports: reportRepo}

	// 短信网关：配置了阿里云短信签名+模板则真发，否则用 dev 网关（仅记日志）
	var smsGateway service.SMSGateway = service.DevSMSGateway{}
	if cfg.SMS.SignName != "" && cfg.SMS.TemplateCode != "" {
		smsGateway = &service.AliyunSMSGateway{
			AccessKeyID:     cfg.SMS.AccessKeyID,
			AccessKeySecret: cfg.SMS.AccessKeySecret,
			SignName:        cfg.SMS.SignName,
			TemplateCode:    cfg.SMS.TemplateCode,
			RegionID:        cfg.SMS.RegionID,
		}
	}
	countryH := &handler.CountryHandler{Repo: countryRepo}
	authH := &handler.AuthHandler{DB: pool, Cfg: cfg, Redis: redisClient, SMS: smsGateway}
	userH := &handler.UserHandler{Svc: userSvc}
	contactH := &handler.ContactHandler{Svc: contactSvc}
	chatH := &handler.ChatHandler{Svc: chatSvc}
	groupH := &handler.GroupHandler{Svc: groupSvc}
	adminGroupH := &handler.AdminGroupHandler{Groups: groupSvc}
	fileH := &handler.FileHandler{MinIO: minioClient, Files: fileRepo}
	imH := &handler.IMHandler{Service: imSvc}
	reportH := &handler.ReportHandler{Svc: reportSvc}
	imInternalH := &handler.IMInternalHandler{Service: imAdminSvc}
	// 消息推送服务：当前用日志桩（仅打印推送意图），后续替换为接入 APNs/FCM/个推 的实现。
	pushSvc := service.NewLoggingPushService()
	openIMWebhookH := handler.NewOpenIMWebhookHandler(
		imAccessRepo, imClient, &repository.RestrictionRepo{DB: pool}, cfg.OpenIM.WebhookSecret, cfg.OpenIM.AdminUser, cfg.OpenIM.WebhookAllowCIDRs, pushSvc,
	)
	// 安全提醒：配置了 webhook 密钥却没配来源 CIDR 白名单时，authorized 会整体拒绝所有回调，
	// 等同于 webhook 功能静默失效——显式打 warning，避免排查时一脸懵。
	if cfg.OpenIM.WebhookSecret != "" && len(cfg.OpenIM.WebhookAllowCIDRs) == 0 {
		log.Println("WARN: OPENIM_WEBHOOK_SECRET 已配置，但未配置 OPENIM_WEBHOOK_ALLOW_CIDRS；" +
			"OpenIM 回调来源 IP 不在白名单内将被全部拒绝（webhook 实际失效）")
	}
	forwardH := &handler.ForwardHandler{Svc: forwardSvc}
	adminForwardH := &handler.AdminForwardHandler{Forward: forwardSvc}
	adminUserH := &handler.AdminUserHandler{Restrictions: &repository.RestrictionRepo{DB: pool}, Client: imClient}
	adminMessageH := &handler.AdminMessageHandler{Client: imClient, DB: pool, IMAccess: imAccessRepo}
	favH := &handler.FavoriteHandler{Svc: favSvc}

	r := gin.New()
	loggerConfig := gin.LoggerConfig{}
	if cfg.OpenIM.WebhookSecret != "" {
		base := "/internal/openim/webhooks/" + cfg.OpenIM.WebhookSecret
		loggerConfig.SkipPaths = []string{
			base + "/callbackBeforeSendSingleMsgCommand",
			base + "/callbackBeforeSendGroupMsgCommand",
			base + "/callbackAfterSendSingleMsgCommand",
			base + "/callbackAfterSendGroupMsgCommand",
			base + "/callbackBeforeAfterMsgCommand",
		}
	}
	r.Use(gin.LoggerWithConfig(loggerConfig), gin.Recovery())
	r.Use(corsMiddleware(cfg.CORSAllowOrigins))

	// health 限流：每 IP 每分钟最多 20 次，防止前端频繁轮询
	r.GET("/health", middleware.RateLimitIP(redisClient, 20, time.Minute, "health"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	if cfg.LegacyChatEnabled {
		r.GET("/ws", hub.HandleWS)
	}
	r.POST("/internal/openim/webhooks/:secret/callbackBeforeSendSingleMsgCommand", openIMWebhookH.BeforeSingle)
	r.POST("/internal/openim/webhooks/:secret/callbackBeforeSendGroupMsgCommand", openIMWebhookH.BeforeGroup)
	r.POST("/internal/openim/webhooks/:secret/callbackAfterSendSingleMsgCommand", openIMWebhookH.AfterMessage)
	r.POST("/internal/openim/webhooks/:secret/callbackAfterSendGroupMsgCommand", openIMWebhookH.AfterMessage)
	r.POST("/internal/openim/webhooks/:secret/callbackBeforeAfterMsgCommand", openIMWebhookH.AfterMessage)
	internalIM := r.Group("/internal/im")
	internalIM.Use(middleware.InternalAPIKey(cfg.IMInternalAPIKey))
	{
		internalIM.POST("/messages", imInternalH.SendMessage)
		internalIM.GET("/health", imInternalH.Health)
		internalIM.POST("/reconcile", imInternalH.Reconcile)
		internalIM.GET("/outbox", imInternalH.ListOutbox)
		internalIM.POST("/outbox/:id/replay", imInternalH.ReplayOutbox)
	}

	// 管理后台内部接口（方案 A：admin 经 HTTP 调 server 执行业务逻辑 + OpenIM 同步）
	internalAdmin := r.Group("/internal/admin")
	internalAdmin.Use(middleware.InternalAPIKey(cfg.IMInternalAPIKey))
	{
		internalAdmin.POST("/groups/:id/dismiss", adminGroupH.DismissGroup)
		internalAdmin.POST("/groups/:id/mute", adminGroupH.MuteGroup)
		internalAdmin.POST("/groups/:id/add-friend", adminGroupH.SetAddFriend)
		internalAdmin.POST("/forward-tasks/:id/cancel", adminForwardH.CancelForwardTask)
		internalAdmin.POST("/forward-tasks/:id/retry", adminForwardH.RetryForwardTask)
		internalAdmin.POST("/users/:id/restriction", adminUserH.SetRestriction)
		internalAdmin.POST("/users/:id/status", adminUserH.SetUserStatus)
		internalAdmin.POST("/users/:id/sessions/revoke", adminUserH.RevokeSessions)
		internalAdmin.POST("/users/:id/reset-profile", adminUserH.ResetProfile)
		internalAdmin.POST("/messages/:id/recall", adminMessageH.RecallMessage)
	}

	api := r.Group("/api/v1")
	{
		api.GET("/public/countries", countryH.Countries)
		api.POST("/auth/sms/send", authH.SendSMS)
		api.POST("/auth/login", authH.Login)
		api.POST("/auth/login/sms", authH.LoginSMS)
		api.POST("/auth/register", authH.Register)
		api.POST("/auth/token/refresh", authH.RefreshToken)
		api.POST("/auth/password/reset", authH.ResetPassword)
		api.POST("/auth/logout", authH.Logout)

		auth := api.Group("")
		auth.Use(middleware.AuthRequired(cfg.JWTSecret))
		{
			auth.POST("/auth/logout-all", authH.LogoutAll)
			auth.GET("/me", userH.Profile)
			auth.PATCH("/me", userH.UpdateProfile)
			auth.POST("/me/password/verify", userH.VerifyPassword)
			auth.PUT("/me/password", userH.ChangePassword)
			auth.GET("/me/privacy-settings", userH.GetPrivacySettings)
			auth.PUT("/me/privacy-settings", userH.UpdatePrivacySettings)
			auth.GET("/me/qrcode", userH.Qrcode)
			auth.POST("/users/qrcode/resolve", userH.ResolveUserQRCode)
			auth.GET("/users/search", userH.Search)
			auth.GET("/users/:id", userH.GetUser)
			auth.GET("/report-reasons", reportH.ListReasons)
			auth.POST("/reports", reportH.Create)

			if cfg.LegacyChatEnabled {
				auth.GET("/conversations", chatH.ListConversations)
				auth.POST("/conversations/read-all", chatH.ReadAll)
				auth.GET("/conversations/:id/messages", chatH.ListMessages)
				auth.POST("/conversations/:id/messages", chatH.SendMessage)
				auth.GET("/contacts/:id/conversation", contactH.GetConversation)
			}

			auth.GET("/contacts", contactH.ListContacts)
			auth.GET("/contacts/:id", contactH.GetContact)
			auth.PATCH("/contacts/:id", contactH.UpdateContact)
			auth.DELETE("/contacts/:id", contactH.DeleteContact)
			auth.POST("/contacts/:id/block", contactH.BlockContact)
			auth.DELETE("/contacts/:id/block", contactH.UnblockContact)

			auth.GET("/contact-tags", contactH.ListTags)
			auth.POST("/contact-tags", contactH.CreateTag)
			auth.PATCH("/contact-tags/:tagId", contactH.UpdateTag)
			auth.DELETE("/contact-tags/:tagId", contactH.DeleteTag)
			auth.GET("/contact-tags/:tagId/members", contactH.ListTagMembers)
			auth.PUT("/contact-tags/:tagId/members", contactH.SetTagMembers)

			auth.GET("/groups", contactH.ListGroups)
			auth.POST("/groups", groupH.Create)
			auth.POST("/groups/qrcode/resolve", groupH.ResolveQRCode)
			auth.POST("/groups/qrcode/join", groupH.JoinByQRCode)
			auth.GET("/groups/:id", groupH.Detail)
			auth.GET("/groups/:id/members", groupH.Members)
			auth.GET("/groups/:id/qrcode", groupH.Qrcode)
			auth.POST("/groups/:id/join", groupH.Join)
			auth.POST("/groups/:id/invitations", groupH.InviteMembers)
			auth.POST("/groups/:id/join-requests", groupH.CreateJoinRequest)
			auth.GET("/groups/:id/join-requests", groupH.ListJoinRequests)
			auth.POST("/groups/:id/join-requests/:requestId/approve", groupH.ApproveJoinRequest)
			auth.POST("/groups/:id/join-requests/:requestId/reject", groupH.RejectJoinRequest)
			auth.PUT("/groups/:id/members/:userId/role", groupH.UpdateMemberRole)
			auth.PUT("/groups/:id/members/:userId/mute", groupH.UpdateMemberMute)
			auth.DELETE("/groups/:id/members/:userId", groupH.RemoveMember)
			auth.PUT("/groups/:id/me/nickname", groupH.UpdateMyNickname)
			auth.PUT("/groups/:id/remark", groupH.UpdateGroupRemark)
			auth.PUT("/groups/:id/members/:userId/remark", groupH.UpdateMemberRemark)
			auth.PUT("/groups/:id/settings", groupH.UpdateSettings)
			auth.POST("/groups/reports", groupH.CreateReport)
			auth.PUT("/groups/:id/mute", groupH.UpdateMute)
			auth.POST("/groups/:id/leave", groupH.Leave)
			auth.POST("/groups/:id/dismiss", groupH.Dismiss)
			auth.POST("/group-invitations/:token/accept", groupH.AcceptInvitation)
			auth.GET("/friend-requests", contactH.ListFriendRequests)
			auth.POST("/friend-requests", contactH.CreateFriendRequest)
			auth.POST("/friend-requests/:id/accept", contactH.AcceptFriendRequest)
			auth.POST("/friend-requests/:id/reject", contactH.RejectFriendRequest)

			if minioClient.Available() {
				auth.POST("/files/presign", fileH.Presign)
			} else {
				auth.POST("/files/presign", handler.DevPresign)
			}
			auth.POST("/files/uploads", fileH.Uploads)
			auth.POST("/files/uploads/complete", fileH.Complete)
			auth.GET("/files", fileH.Get)

			auth.POST("/im/token", imH.Token)
			auth.GET("/im/peers/:businessUserId", imH.Peer)
			auth.GET("/im/groups/:businessGroupId", imH.Group)
			auth.GET("/im/groups/by-im/:imGroupId", imH.GroupByIM)

			// 会话设置配置接口（IM 有的都要出）：免打扰/置顶/阅后即焚/消息定时销毁/备注/@强提醒/草稿/已读/全局免打扰
			// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（后端拼 conversationId）
			auth.GET("/im/conversations/:peerType/:peerId", imH.GetConversation)
			auth.PATCH("/im/conversations/:peerType/:peerId", imH.UpdateConversation)
			auth.POST("/im/conversation-messages/clear", imH.ClearConversationMessages)
			auth.POST("/im/conversations/:peerType/:peerId/read", imH.MarkConversationRead)
			auth.PUT("/im/me/global-msg-recv-opt", imH.SetGlobalMsgRecvOpt)

			// 消息推送（来消息提示）：前端注册/注销设备推送凭证
			auth.POST("/im/me/push-token", imH.RegisterPushToken)
			auth.DELETE("/im/me/push-token", imH.UnregisterPushToken)

			// 新增写接口全部使用静态路径 + JSON body；旧 GET 动态路径仅保留兼容。
			auth.POST("/forward-tasks", forwardH.Create)
			auth.GET("/forward-tasks", forwardH.List)
			auth.GET("/forward-tasks/:id", forwardH.GetLegacy)
			auth.GET("/forward-task-progress", forwardH.Progress)
			auth.GET("/forward-task-targets", forwardH.ListTargets)
			auth.POST("/forward-task-targets/add", forwardH.AddTargets)
			auth.POST("/forward-task-targets/generate", forwardH.GenerateTargets)
			auth.POST("/forward-task-targets/remove", forwardH.RemoveTargets)
			auth.POST("/forward-task-targets/clear", forwardH.ClearTargets)
			auth.POST("/forward-tasks/submit", forwardH.Submit)
			auth.POST("/forward-tasks/cancel", forwardH.Cancel)
			auth.POST("/forward-tasks/retry", forwardH.Retry)
			auth.POST("/forward-tasks/pause", forwardH.Pause)
			auth.POST("/forward-tasks/resume", forwardH.Resume)

			// 收藏
			auth.POST("/favorites/list", favH.List)
			auth.POST("/favorites", favH.Create)
			auth.DELETE("/favorites/:favoriteId", favH.Delete)
		}
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	workerCtx, stopWorker := context.WithCancel(context.Background())
	if kafkaQueue.Available() {
		outboxPublisher := &service.ForwardOutboxPublisher{
			Repo: forwardRepo, Kafka: kafkaQueue,
			BatchSize: 20, PollInterval: time.Duration(cfg.Forward.PollSeconds) * time.Second,
			LockTTL: time.Minute,
		}
		go outboxPublisher.Run(workerCtx)
		log.Printf("forward Kafka enabled: brokers=%s topic=%s group=%s",
			cfg.Kafka.Brokers, cfg.Kafka.Topic, cfg.Kafka.GroupID)
	} else {
		log.Println("forward Kafka disabled: KAFKA_BROKERS is missing; submit/resume/retry will return 503")
	}
	if imClient.Available() {
		imWorker := &service.IMSyncWorker{
			Outbox: imOutboxRepo, Users: userRepo, Groups: groupRepo, Access: imAccessRepo, Client: imClient,
			BatchSize: 20, MaxAttempts: 10, PollInterval: 2 * time.Second,
		}
		go imWorker.Run(workerCtx)
		if cfg.Forward.WorkerEnabled && kafkaQueue.Available() {
			forwardWorker := &service.ForwardWorker{
				Repo: forwardRepo, Client: imClient, Kafka: kafkaQueue,
				BatchSize: cfg.Forward.BatchSize, MaxAttempts: cfg.Forward.MaxAttempts,
				Concurrency: cfg.Forward.Concurrency, QPS: cfg.Forward.QPS,
				PollInterval: time.Duration(cfg.Forward.PollSeconds) * time.Second,
				LockTTL:      time.Duration(cfg.Forward.LockSeconds) * time.Second,
			}
			go forwardWorker.Run(workerCtx)
			log.Printf("forward worker enabled: batch=%d concurrency=%d qps=%d",
				cfg.Forward.BatchSize, cfg.Forward.Concurrency, cfg.Forward.QPS)
		}
	} else {
		log.Println("OpenIM sync worker disabled: OPENIM_API_URL or OPENIM_SECRET is missing")
	}

	go func() {
		log.Printf("IM API listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	stopWorker()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// corsMiddleware 跨域处理。配置了允许源白名单时，仅对白名单内的 Origin 回显
// （并允许携带凭证）；未配置白名单时回退为通配 *（仅建议本地开发）。
func corsMiddleware(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	allowAll := len(allowedOrigins) == 0
	for _, o := range allowedOrigins {
		o = strings.TrimSpace(o)
		switch o {
		case "":
			continue
		case "*":
			allowAll = true
		default:
			allowed[o] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		switch {
		case allowAll:
			c.Header("Access-Control-Allow-Origin", "*")
		case origin != "":
			if _, ok := allowed[origin]; ok {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Access-Control-Allow-Credentials", "true")
				c.Header("Vary", "Origin")
			}
		}
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
