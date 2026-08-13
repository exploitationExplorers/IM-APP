package config

import (
	"os"
	"strconv"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	JWTSecret   string
	DevSMSCode  string
	RedisURL    string
	MinIO       MinIOConfig
	OpenIM      OpenIMConfig
	Kafka       KafkaConfig
	SMS         SMSConfig
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
	APIURL    string
	Secret    string
	AdminUser string
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
	return Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: getenv("DATABASE_URL", "postgres://im:im123456@127.0.0.1:5433/im_app?sslmode=disable"),
		JWTSecret:   getenv("JWT_SECRET", "im-local-dev-secret-change-me"),
		DevSMSCode:  getenv("DEV_SMS_CODE", "123456"),
		RedisURL:    getenv("REDIS_URL", ""),
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
			APIURL:    getenv("OPENIM_API_URL", ""),
			Secret:    getenv("OPENIM_SECRET", ""),
			AdminUser: getenv("OPENIM_ADMIN_USER", "imAdmin"),
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
