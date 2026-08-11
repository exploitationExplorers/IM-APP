package infra

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis wraps optional Redis client; nil means fallback to DB-only mode.
type Redis struct {
	Client *redis.Client
}

func NewRedis(redisURL string) (*Redis, error) {
	if redisURL == "" {
		return &Redis{}, nil
	}
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &Redis{Client: client}, nil
}

func (r *Redis) Available() bool {
	return r != nil && r.Client != nil
}

// AllowSMS checks per-phone SMS send rate (1/min). Returns false if limited.
func (r *Redis) AllowSMS(ctx context.Context, phone string) (bool, error) {
	if !r.Available() {
		return true, nil
	}
	key := "sms:rate:" + phone
	ok, err := r.Client.SetNX(ctx, key, "1", time.Minute).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

func (r *Redis) Close() error {
	if !r.Available() {
		return nil
	}
	return r.Client.Close()
}
