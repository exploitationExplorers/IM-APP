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
)

func main() {
	cfg := config.Load()

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

	adminRepo := &repository.AdminRepo{DB: pool}
	dataRepo := &repository.DataRepo{DB: pool}
	if err := adminRepo.SeedDefault(context.Background()); err != nil {
		log.Printf("seed admin: %v", err)
	}

	adminSvc := &service.AdminService{Repo: adminRepo}
	dataSvc := &service.DataService{Repo: dataRepo}

	adminH := &handler.AdminHandler{Svc: adminSvc, Secret: cfg.JWTSecret}
	dataH := &handler.DataHandler{Data: dataSvc, Admin: adminSvc}

	r := gin.Default()
	r.Use(corsMiddleware())

	api := r.Group("/api/admin")
	{
		api.POST("/login", adminH.Login)

		auth := api.Group("")
		auth.Use(middleware.AuthRequired(cfg.JWTSecret))
		{
			// 管理员与权限
			auth.GET("/me", adminH.Me)
			auth.GET("/admins", adminH.ListAdmins)
			auth.POST("/admins", adminH.CreateAdmin)
			auth.PUT("/admins/:id", adminH.UpdateAdmin)
			auth.GET("/roles", adminH.ListRoles)
			auth.POST("/roles", adminH.CreateRole)
			auth.PUT("/roles/:id/permissions", adminH.SetRolePermissions)
			auth.GET("/operation-logs", adminH.ListOperationLogs)

			// 用户管理
			auth.GET("/users", dataH.ListUsers)
			auth.GET("/users/:id", dataH.GetUser)
			auth.PUT("/users/:id/status", dataH.UpdateUserStatus)
			auth.GET("/users/:id/reports", dataH.ListUserReports)

			// 群组管理
			auth.GET("/groups", dataH.ListGroups)
			auth.GET("/groups/:id", dataH.GetGroupDetail)
			auth.GET("/groups/:id/members", dataH.ListGroupMembers)
			auth.PUT("/groups/:id/status", dataH.UpdateGroupStatus)
			auth.PUT("/groups/:id/settings", dataH.UpdateGroupSettings)
			auth.PUT("/groups/:id/mute-all", dataH.MuteGroupAll)
			auth.GET("/groups/:id/recall-logs", dataH.ListGroupRecallLogs)

			// 转发任务 / 短信记录
			auth.GET("/forward-tasks", dataH.ListForwardTasks)
			auth.GET("/sms-logs", dataH.ListSmsLogs)
			auth.GET("/countries", dataH.ListCountries)
			auth.PUT("/countries/:code", dataH.UpdateCountry)

			// 运营配置
			auth.GET("/app-versions", dataH.ListAppVersions)
			auth.POST("/app-versions", dataH.CreateAppVersion)
			auth.GET("/policies", dataH.ListPolicies)
			auth.PUT("/policies", dataH.SavePolicy)
			auth.GET("/sensitive-words", dataH.ListSensitiveWords)
			auth.POST("/sensitive-words", dataH.CreateSensitiveWord)
			auth.DELETE("/sensitive-words/:id", dataH.DeleteSensitiveWord)
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
