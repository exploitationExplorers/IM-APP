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
	log.Println("migrations applied")

	{
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := db.SeedDemo(ctx, pool); err != nil {
			cancel()
			log.Fatalf("seed: %v", err)
		}
		cancel()
	}

	hub := ws.NewHub(cfg.JWTSecret)

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

	kafkaProducer := infra.NewKafka(cfg.Kafka.Brokers, cfg.Kafka.Topic)
	imClient := im.NewClient(cfg.OpenIM)

	userRepo := &repository.UserRepo{DB: pool}
	contactRepo := &repository.ContactRepo{DB: pool}
	contactTagRepo := &repository.ContactTagRepo{DB: pool}
	chatRepo := &repository.ChatRepo{DB: pool}
	fileRepo := &repository.FileRepo{DB: pool}

	groupRepo := &repository.GroupRepo{DB: pool}

	userSvc := &service.UserService{Users: userRepo, Files: fileRepo, Contacts: contactRepo}
	contactSvc := &service.ContactService{Contacts: contactRepo, Users: userRepo, Tags: contactTagRepo}
	chatSvc := &service.ChatService{Chat: chatRepo, Hub: hub}
	groupSvc := &service.GroupService{Groups: groupRepo}
	forwardSvc := &service.ForwardService{DB: pool, Kafka: kafkaProducer}

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
	authH := &handler.AuthHandler{DB: pool, Cfg: cfg, Redis: redisClient, SMS: smsGateway}
	userH := &handler.UserHandler{Svc: userSvc}
	contactH := &handler.ContactHandler{Svc: contactSvc}
	chatH := &handler.ChatHandler{Svc: chatSvc}
	groupH := &handler.GroupHandler{Svc: groupSvc}
	fileH := &handler.FileHandler{MinIO: minioClient, Files: fileRepo}
	imH := &handler.IMHandler{Client: imClient}
	forwardH := &handler.ForwardHandler{Svc: forwardSvc}

	r := gin.Default()
	r.Use(corsMiddleware())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/ws", hub.HandleWS)

	api := r.Group("/api/v1")
	{
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
			auth.PUT("/me/password", userH.ChangePassword)
			auth.GET("/me/qrcode", userH.Qrcode)
			auth.POST("/users/qrcode/resolve", userH.ResolveUserQRCode)
			auth.GET("/users/search", userH.Search)
			auth.GET("/users/:id", userH.GetUser)

			auth.GET("/conversations", chatH.ListConversations)
			auth.POST("/conversations/read-all", chatH.ReadAll)
			auth.GET("/conversations/:id/messages", chatH.ListMessages)
			auth.POST("/conversations/:id/messages", chatH.SendMessage)

			auth.GET("/contacts", contactH.ListContacts)
			auth.GET("/contacts/:id", contactH.GetContact)
			auth.PATCH("/contacts/:id", contactH.UpdateContact)
			auth.GET("/contacts/:id/conversation", contactH.GetConversation)
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
			auth.PUT("/groups/:id/members/:userId/mute", groupH.MuteMember)
			auth.DELETE("/groups/:id/members/:userId", groupH.RemoveMember)
			auth.PUT("/groups/:id/settings", groupH.UpdateSettings)
			auth.POST("/groups/:id/leave", groupH.Leave)
			auth.DELETE("/groups/:id", groupH.Dissolve)
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
			auth.POST("/files/uploads/:fileId/complete", fileH.Complete)
			auth.GET("/files/:fileId", fileH.Get)

			auth.POST("/im/token", imH.Token)
			auth.POST("/forward-tasks", forwardH.Create)
			auth.GET("/forward-tasks/:id", forwardH.Get)
		}
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
