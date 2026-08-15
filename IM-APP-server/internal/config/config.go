package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr          string
	DatabaseURL       string
	JWTSecret         string
	DevSMSCode        string
	RedisURL          string
	MinIO             MinIOConfig
	OpenIM            OpenIMConfig
	IMInternalAPIKey  string
	LegacyChatEnabled bool
	SeedDemo          bool
	Kafka             KafkaConfig
	SMS               SMSConfig
}

type MinIOConfig struct {
	Endpoint   string
	AccessKey  string
	SecretKey  string
	Bucket     string
	UseSSL     bool
	PublicURL  string // 对外可访问的 MinIO 地址（如 http://8.210.72.157:9000），空则用内部 Endpoint
	PublicRead bool   // true 时启动自动把桶设为公开读（外网可直接访问文件 URL）
}

type OpenIMConfig struct {
	APIURL            string
	PublicAPIURL      string
	PublicWSURL       string
	Secret            string
	AdminUser         string
	WebhookSecret     string
	WebhookAllowCIDRs []string
}

type KafkaConfig struct {
	Brokers string
	Topic   string
}

// SMSConfig 阿里云短信服务（Dysmsapi SendSms）
type SMSConfig struct {
	AccessKeyID     string // 阿里云 AccessKey
	AccessKeySecret string
	SignName        string // 短信签名（阿里云控制台申请）
	TemplateCode    string // 短信模板 Code
	RegionID        string // 默认 cn-hangzhou
}

func Load() Config {
	loadDotEnv(".env")

	return Config{
		HTTPAddr:          getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:       getenv("DATABASE_URL", "postgres://im:im123456@127.0.0.1:5433/im_app?sslmode=disable"),
		JWTSecret:         getenv("JWT_SECRET", "im-local-dev-secret-change-me"),
		IMInternalAPIKey:  getenv("IM_INTERNAL_API_KEY", ""),
		LegacyChatEnabled: getenvBool("LEGACY_CHAT_ENABLED", false),
		SeedDemo:          getenvBool("SEED_DEMO", false),
		DevSMSCode:        getenv("DEV_SMS_CODE", ""),
		RedisURL:          getenv("REDIS_URL", ""),
		MinIO: MinIOConfig{
			Endpoint:   getenv("MINIO_ENDPOINT", ""),
			AccessKey:  getenv("MINIO_ACCESS_KEY", "minioadmin"),
			SecretKey:  getenv("MINIO_SECRET_KEY", "minioadmin123"),
			Bucket:     getenv("MINIO_BUCKET", "im-uploads"),
			UseSSL:     getenv("MINIO_USE_SSL", "false") == "true",
			PublicURL:  getenv("MINIO_PUBLIC_URL", ""),
			PublicRead: getenv("MINIO_PUBLIC_READ", "false") == "true",
		},
		OpenIM: OpenIMConfig{
			APIURL:            getenv("OPENIM_API_URL", ""),
			PublicAPIURL:      getenv("OPENIM_PUBLIC_API_URL", ""),
			PublicWSURL:       getenv("OPENIM_PUBLIC_WS_URL", ""),
			Secret:            getenv("OPENIM_SECRET", ""),
			AdminUser:         getenv("OPENIM_ADMIN_USER", "imAdmin"),
			WebhookSecret:     getenv("OPENIM_WEBHOOK_SECRET", ""),
			WebhookAllowCIDRs: splitCSV(getenv("OPENIM_WEBHOOK_ALLOW_CIDRS", "")),
		},
		Kafka: KafkaConfig{
			Brokers: getenv("KAFKA_BROKERS", ""),
			Topic:   getenv("KAFKA_FORWARD_TOPIC", "im-forward-tasks"),
		},
		SMS: SMSConfig{
			AccessKeyID:     getenv("ALIYUN_ACCESS_KEY_ID", ""),
			AccessKeySecret: getenv("ALIYUN_ACCESS_KEY_SECRET", ""),
			SignName:        getenv("SMS_SIGN_NAME", ""),
			TemplateCode:    getenv("SMS_TEMPLATE_CODE", ""),
			RegionID:        getenv("SMS_REGION_ID", "cn-hangzhou"),
		},
	}
}

// loadDotEnv 读取工作目录下的 .env，让 `go run ./cmd/server` 与 README 描述一致。
// 已存在的进程环境变量优先，docker compose 注入的值不会被文件覆盖。
func loadDotEnv(path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		return
	}

	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "\ufeff"))
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"'`))
	}
}

func getenvBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func GetenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
