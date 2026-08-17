package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string

	// 管理端 JWT 独立密钥，避免与 APP 的 JWT_SECRET 撞车（清单 3.2）
	AdminJWTSecret  string
	JWTIssuer       string
	JWTAudience     string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration

	// 登录安全（清单 01.3）
	LoginFailThreshold int
	LoginLockMinutes   int

	// 首个超级管理员初始化（一次性部署流程，不写死演示密码）
	BootstrapPassword string
	BootstrapUsername string

	// 安全基线（清单 00）
	CORSOrigins     []string
	MaxBodyBytes    int64
	TrustedProxies  []string
	RequestIDHeader string
}

func Load() Config {
	return Config{
		HTTPAddr:           getenv("HTTP_ADDR", ":8081"),
		// 默认值不携带口令，避免弱默认口令被复用；生产必须显式配置 DATABASE_URL
		DatabaseURL:        getenv("DATABASE_URL", "postgres://im@127.0.0.1:5433/im_app?sslmode=disable"),
		AdminJWTSecret:     adminJWTSecret(),
		JWTIssuer:          "im-admin",
		JWTAudience:        "im-admin-web",
		AccessTokenTTL:     durationEnv("ADMIN_ACCESS_TTL", 2*time.Hour),
		RefreshTokenTTL:    durationEnv("ADMIN_REFRESH_TTL", 7*24*time.Hour),
		LoginFailThreshold: intEnv("ADMIN_LOGIN_FAIL_THRESHOLD", 5),
		LoginLockMinutes:   intEnv("ADMIN_LOGIN_LOCK_MINUTES", 15),
		BootstrapPassword:  rawEnv("ADMIN_BOOTSTRAP_PASSWORD"),
		BootstrapUsername:  getenv("ADMIN_BOOTSTRAP_USERNAME", "admin"),
		CORSOrigins:        splitCSV(getenv("ADMIN_CORS_ORIGINS", "http://localhost:5180")),
		MaxBodyBytes:       1 << 20, // 1MB
		TrustedProxies:     splitCSV(getenv("ADMIN_TRUSTED_PROXIES", "")),
		RequestIDHeader:    "X-Request-Id",
	}
}

// fileEnv 从同目录 .env 文件加载的键值（系统环境变量优先，.env 兜底）
var fileEnv = loadEnvFile(".env")

// rawEnv 读取配置：系统环境变量优先，其次 .env 文件
func rawEnv(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	if v := fileEnv[key]; v != "" {
		return v
	}
	return ""
}

// loadEnvFile 解析 .env 文件：KEY=value，忽略 # 注释与空行，支持引号包裹
func loadEnvFile(path string) map[string]string {
	m := make(map[string]string)
	data, err := os.ReadFile(path)
	if err != nil {
		return m
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.Trim(strings.TrimSpace(line[idx+1:]), `"'`)
		if key != "" {
			m[key] = val
		}
	}
	return m
}

// adminJWTSecret 管理端密钥：优先 ADMIN_JWT_SECRET（独立密钥，清单 3.2），
// 未设置时兼容读取 JWT_SECRET（与 APP 共用时 issuer/audience 仍隔离），最后用开发默认值。
func adminJWTSecret() string {
	if v := rawEnv("ADMIN_JWT_SECRET"); v != "" {
		return v
	}
	if v := rawEnv("JWT_SECRET"); v != "" {
		return v
	}
	return "im-admin-dev-secret-change-me"
}

// WeakJWTSecret 报告 JWT 密钥是否过弱（长度 <32 字节，或命中已知默认值）。
// 生产环境应拒绝使用弱密钥，否则攻击者可伪造任意管理员 token。
func (c Config) WeakJWTSecret() bool {
	if len(c.AdminJWTSecret) < 32 {
		return true
	}
	switch c.AdminJWTSecret {
	case "im-admin-dev-secret-change-me", "im-local-dev-secret-change-me":
		return true
	}
	return false
}

func getenv(key, fallback string) string {
	if v := rawEnv(key); v != "" {
		return v
	}
	return fallback
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	v := rawEnv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func intEnv(key string, fallback int) int {
	v := rawEnv(key)
	if v == "" {
		return fallback
	}
	n := 0
	for _, r := range v {
		if r < '0' || r > '9' {
			return fallback
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func splitCSV(s string) []string {
	out := make([]string, 0)
	cur := ""
	for _, r := range s {
		if r == ',' {
			if cur != "" {
				out = append(out, cur)
			}
			cur = ""
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
