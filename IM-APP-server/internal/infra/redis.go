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

// CacheGet reads an optional application cache entry. A missing key is not an
// error so callers can transparently fall back to their source of truth.
func (r *Redis) CacheGet(ctx context.Context, key string) (string, bool, error) {
	if !r.Available() {
		return "", false, nil
	}
	value, err := r.Client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// CacheSet stores an application cache entry with a bounded lifetime.
func (r *Redis) CacheSet(ctx context.Context, key, value string, ttl time.Duration) error {
	if !r.Available() {
		return nil
	}
	return r.Client.Set(ctx, key, value, ttl).Err()
}

// GroupReadCursorUpsert 保存群成员的单调已读游标。ZSET 只保留每个用户一个分值。
func (r *Redis) GroupReadCursorUpsert(ctx context.Context, key, userID string, seq int64) error {
	if !r.Available() {
		return nil
	}
	return r.Client.ZAdd(ctx, key, redis.Z{Score: float64(seq), Member: userID}).Err()
}

// GroupReadCursorMaxOther 只读取最高的两个游标，从而排除查询者本人，复杂度不随群人数线性增长。
func (r *Redis) GroupReadCursorMaxOther(ctx context.Context, key, userID string) (int64, bool, error) {
	if !r.Available() {
		return 0, false, nil
	}
	items, err := r.Client.ZRevRangeWithScores(ctx, key, 0, 1).Result()
	if err != nil {
		return 0, false, err
	}
	for _, item := range items {
		if fmt.Sprint(item.Member) != userID {
			return int64(item.Score), true, nil
		}
	}
	return 0, false, nil
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

// AllowIP 按 key（如客户端 IP）做固定窗口限流：window 时间内最多 limit 次，超限返回 false
func (r *Redis) AllowIP(ctx context.Context, key string, limit int, window time.Duration) bool {
	if !r.Available() {
		return true // Redis 不可用时不做限制
	}
	k := "rl:" + key
	cnt, err := r.Client.Incr(ctx, k).Result()
	if err != nil {
		return true
	}
	if cnt == 1 {
		r.Client.Expire(ctx, k, window)
	}
	return cnt <= int64(limit)
}

func (r *Redis) Close() error {
	if !r.Available() {
		return nil
	}
	return r.Client.Close()
}
