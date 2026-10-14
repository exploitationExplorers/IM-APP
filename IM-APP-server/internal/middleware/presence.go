package middleware

import (
	"context"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// TouchLastSeen 在已登录请求上顺手记下最近上线。进程内 60 秒只打一次，不挡主请求。
func TouchLastSeen(touch func(ctx context.Context, userID string) error) gin.HandlerFunc {
	var mu sync.Mutex
	last := map[string]time.Time{}
	return func(c *gin.Context) {
		uid := UserID(c)
		if uid != "" && touch != nil && claimLastSeen(uid, &mu, last) {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = touch(ctx, uid)
			}()
		}
		c.Next()
	}
}

func claimLastSeen(uid string, mu *sync.Mutex, last map[string]time.Time) bool {
	now := time.Now()
	mu.Lock()
	defer mu.Unlock()
	if prev, ok := last[uid]; ok && now.Sub(prev) < time.Minute {
		return false
	}
	last[uid] = now
	if len(last) > 20000 {
		cutoff := now.Add(-2 * time.Minute)
		for id, at := range last {
			if at.Before(cutoff) {
				delete(last, id)
			}
		}
	}
	return true
}
