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
	Captcha     CaptchaConfig
}

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
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

// CaptchaConfig 腾讯云图形验证码（天御 Captcha）
type CaptchaConfig struct {
	AppID        int64  // 验证码应用 ID（控制台获取）
	AppSecretKey string // 验证码应用密钥
	SecretID     string // 腾讯云 API 密钥（TC3 签名用）
	SecretKey    string
}

func Load() Config {
	return Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: getenv("DATABASE_URL", "postgres://im:im123456@127.0.0.1:5433/im_app?sslmode=disable"),
		JWTSecret:   getenv("JWT_SECRET", "im-local-dev-secret-change-me"),
		DevSMSCode:  getenv("DEV_SMS_CODE", "123456"),
		RedisURL:    getenv("REDIS_URL", ""),
		MinIO: MinIOConfig{
			Endpoint:  getenv("MINIO_ENDPOINT", ""),
			AccessKey: getenv("MINIO_ACCESS_KEY", "minioadmin"),
			SecretKey: getenv("MINIO_SECRET_KEY", "minioadmin123"),
			Bucket:    getenv("MINIO_BUCKET", "im-uploads"),
			UseSSL:    getenv("MINIO_USE_SSL", "false") == "true",
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
		Captcha: CaptchaConfig{
			AppID:        int64(GetenvInt("CAPTCHA_APP_ID", 0)),
			AppSecretKey: getenv("CAPTCHA_APP_SECRET_KEY", ""),
			SecretID:     getenv("TENCENTCLOUD_SECRET_ID", ""),
			SecretKey:    getenv("TENCENTCLOUD_SECRET_KEY", ""),
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
