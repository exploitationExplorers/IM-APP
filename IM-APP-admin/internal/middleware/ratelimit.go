package middleware

import (
	"sync"
	"time"
)

// LoginLimiter 登录失败锁定（内存实现；清单 01.3：连续失败达阈值临时锁定）
// 不依赖 Redis，单实例部署即可用；多实例如需共享应换 Redis
type LoginLimiter struct {
	mu           sync.Mutex
	failures     map[string]int
	lockedUntil  map[string]time.Time
	threshold    int
	lockDuration time.Duration
}

func NewLoginLimiter(threshold int, lockMinutes int) *LoginLimiter {
	return &LoginLimiter{
		failures:     make(map[string]int),
		lockedUntil:  make(map[string]time.Time),
		threshold:    threshold,
		lockDuration: time.Duration(lockMinutes) * time.Minute,
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

// RecordFailure 记录一次登录失败；达到阈值则锁定
func (l *LoginLimiter) RecordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if until, ok := l.lockedUntil[key]; ok && time.Now().Before(until) {
		return
	}
	l.failures[key]++
	if l.failures[key] >= l.threshold {
		l.lockedUntil[key] = time.Now().Add(l.lockDuration)
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
