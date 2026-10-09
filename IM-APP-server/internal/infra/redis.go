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

// incrWithTTLScript 原子地「自增 + 首次设置 TTL」。
//
// 之前三条限流器是 Incr 之后再单独发一条 Expire：两步非原子，而且 Expire 的
// 返回值被丢弃。只要那一次 Expire 没生效（两条命令之间进程退出、Redis 抖动、
// 连接被掐），这个 key 就永远不带 TTL，计数再也不会重置——对应的 IP / 指纹 /
// 设备会被**永久**限流。合并成一次 Lua 往返即可，Redis 单线程执行没有中间态。
var incrWithTTLScript = redis.NewScript(`
local cnt = redis.call('INCR', KEYS[1])
if cnt == 1 and tonumber(ARGV[1]) > 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return cnt
`)

func (r *Redis) incrWithTTL(ctx context.Context, key string, window time.Duration) (int64, error) {
	return incrWithTTLScript.Run(ctx, r.Client, []string{key}, window.Milliseconds()).Int64()
}

// AllowIP 按 key（如客户端 IP）做固定窗口限流：window 时间内最多 limit 次，超限返回 false
func (r *Redis) AllowIP(ctx context.Context, key string, limit int, window time.Duration) bool {
	if !r.Available() {
		return true // Redis 不可用时不做限制
	}
	cnt, err := r.incrWithTTL(ctx, "rl:"+key, window)
	if err != nil {
		return true
	}
	return cnt <= int64(limit)
}

// AllowFingerprint 按设备指纹限流：window 内最多 limit 次，超限返回 false。
func (r *Redis) AllowFingerprint(ctx context.Context, fp string, limit int, window time.Duration) bool {
	if !r.Available() {
		return true
	}
	cnt, err := r.incrWithTTL(ctx, "sms:fp:"+fp, window)
	if err != nil {
		return true
	}
	return cnt <= int64(limit)
}

// AllowDeviceID 按客户端 DeviceID 限流：window 内最多 limit 次，超限返回 false。
// DeviceID 为空时跳过检查（放行）。
func (r *Redis) AllowDeviceID(ctx context.Context, deviceID string, limit int, window time.Duration) bool {
	if !r.Available() || deviceID == "" {
		return true
	}
	cnt, err := r.incrWithTTL(ctx, "sms:did:"+deviceID, window)
	if err != nil {
		return true
	}
	return cnt <= int64(limit)
}

// CheckIPDeviceFarm 检测同一 IP 下是否出现过多不同设备指纹（设备农场特征）。
// 将当前指纹加入集合，若集合大小超过 maxFP 则封禁该 IP（设置标记 key，TTL=blockDur）。
// 返回 true=放行, false=触发农场封禁。
func (r *Redis) CheckIPDeviceFarm(ctx context.Context, ip, fp string, maxFP int, window, blockDur time.Duration) bool {
	if !r.Available() {
		return true
	}
	k := "sms:ip-fps:" + ip
	r.Client.SAdd(ctx, k, fp)
	r.Client.Expire(ctx, k, window)
	count, err := r.Client.SCard(ctx, k).Result()
	if err != nil {
		return true
	}
	if count > int64(maxFP) {
		r.Client.Set(ctx, "sms:ip-farmed:"+ip, "1", blockDur)
		return false
	}
	return true
}

// IsIPFarmBlocked 检查 IP 是否已被标记为设备农场。
func (r *Redis) IsIPFarmBlocked(ctx context.Context, ip string) bool {
	if !r.Available() {
		return false
	}
	_, err := r.Client.Get(ctx, "sms:ip-farmed:"+ip).Result()
	if err != nil {
		return false
	}
	return true
}

// IsBlacklisted 检查设备指纹或 DeviceID 是否在黑名单中。
// 任一命中即返回 true。
func (r *Redis) IsBlacklisted(ctx context.Context, fp, deviceID string) bool {
	if !r.Available() {
		return false
	}
	if fp != "" {
		if v, err := r.Client.Get(ctx, "sms:bl:fp:"+fp).Result(); err == nil && v != "" {
			return true
		}
	}
	if deviceID != "" {
		if v, err := r.Client.Get(ctx, "sms:bl:did:"+deviceID).Result(); err == nil && v != "" {
			return true
		}
	}
	return false
}

// AddToBlacklist 将设备指纹或 DeviceID 加入 Redis 黑名单。
// reason 存为 value，ttl 为过期时间（0=永不过期）。
func (r *Redis) AddToBlacklist(ctx context.Context, fp, deviceID, reason string, ttl time.Duration) error {
	if !r.Available() {
		return nil
	}
	if fp != "" {
		if err := r.Client.Set(ctx, "sms:bl:fp:"+fp, reason, ttl).Err(); err != nil {
			return err
		}
	}
	if deviceID != "" {
		if err := r.Client.Set(ctx, "sms:bl:did:"+deviceID, reason, ttl).Err(); err != nil {
			return err
		}
	}
	return nil
}

func (r *Redis) Close() error {
	if !r.Available() {
		return nil
	}
	return r.Client.Close()
}
