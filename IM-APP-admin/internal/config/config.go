package config

import "os"

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	JWTSecret   string
}

func Load() Config {
	return Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8081"),
		DatabaseURL: getenv("DATABASE_URL", "postgres://im:im123456@127.0.0.1:5433/im_app?sslmode=disable"),
		JWTSecret:   getenv("JWT_SECRET", "im-admin-dev-secret-change-me"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
