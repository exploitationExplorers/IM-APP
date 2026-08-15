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
	"im-app-admin/internal/server"
	"im-app-admin/internal/service"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	cfg := config.Load()
	if cfg.WeakJWTSecret() {
		if mode := os.Getenv("GIN_MODE"); mode == "release" || mode == "test" {
			log.Fatalf("config: ADMIN_JWT_SECRET 过弱（长度<32 或为已知默认值），生产环境拒绝启动，请设置强随机密钥")
		}
		log.Println("WARN: ADMIN_JWT_SECRET 使用弱/默认密钥，仅限开发环境，生产必须设置独立强密钥")
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
	dataSvc := &service.DataService{Repo: &repository.DataRepo{DB: pool}}
	opsSvc := &service.OpsService{Repo: &repository.OpsRepo{DB: pool}}

	authH := &handler.AuthHandler{
		Svc:     authSvc,
		Limiter: middleware.NewLoginLimiter(cfg.LoginFailThreshold, cfg.LoginLockMinutes),
	}
	rbacH := &handler.RBACHandler{Svc: rbacSvc}
	dataH := &handler.DataHandler{Data: dataSvc}
	opsH := &handler.OpsHandler{Svc: opsSvc}
	metaH := &handler.MetaHandler{Version: "1.0.0", Commit: "dev", BuildTime: time.Now().UTC().Format(time.RFC3339), Svc: opsSvc}

	r := server.BuildRouter(server.Deps{
		Cfg:       cfg,
		RbacRepo:  rbacRepo,
		AuditRepo: auditRepo,
		AuthH:     authH,
		RBACH:     rbacH,
		DataH:     dataH,
		OpsH:      opsH,
		MetaH:     metaH,
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
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
