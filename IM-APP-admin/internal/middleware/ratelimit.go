package middleware

import (
	"sync"
	"time"
)

// LoginLimiter 登录失败锁定（内存实现；清单 01.3：连续失败达阈值临时锁定）
// 不依赖 Redis，单实例部署即可用；多实例如需共享应换 Redis
// 失败记录带时间戳并限定在窗口内统计：零星失败会随窗口过期自动衰减，map 有界不会无限增长
type LoginLimiter struct {
	mu           sync.Mutex
	failures     map[string][]time.Time // 窗口内的失败时间戳
	lockedUntil  map[string]time.Time
	threshold    int
	lockDuration time.Duration
	window       time.Duration
}

func NewLoginLimiter(threshold int, lockMinutes int) *LoginLimiter {
	w := time.Duration(lockMinutes) * time.Minute
	return &LoginLimiter{
		failures:     make(map[string][]time.Time),
		lockedUntil:  make(map[string]time.Time),
		threshold:    threshold,
		lockDuration: w,
		window:       w,
	}
}

// IsLocked 返回 key 是否被临时锁定及剩余时间
func (l *LoginLimiter) IsLocked(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	until, ok := l.lockedUntil[key]
	if !ok {
		return false, 0
	}
	if time.Now().Before(until) {
		return true, time.Until(until)
	}
	delete(l.lockedUntil, key)
	delete(l.failures, key)
	return false, 0
}

// RecordFailure 记录一次登录失败；窗口内达到阈值则锁定
func (l *LoginLimiter) RecordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if until, ok := l.lockedUntil[key]; ok && time.Now().Before(until) {
		return
	}
	now := time.Now()
	// 仅保留窗口内的失败记录，窗口外自动淘汰（既有界，又避免零星失败永久累积到阈值）
	recent := l.failures[key][:0]
	for _, t := range l.failures[key] {
		if now.Sub(t) <= l.window {
			recent = append(recent, t)
		}
	}
	recent = append(recent, now)
	l.failures[key] = recent
	if len(recent) >= l.threshold {
		l.lockedUntil[key] = now.Add(l.lockDuration)
		delete(l.failures, key)
	}
}

// Clear 登录成功后清除失败计数
func (l *LoginLimiter) Clear(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
	delete(l.lockedUntil, key)
}
