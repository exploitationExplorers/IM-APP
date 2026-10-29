package im

import (
	"context"
	"testing"

	"im-app-server/internal/config"
)

// OpenIM 未配置时，注销流程调用的清理方法必须明确报「不可用」而不是假装成功，
// 否则上层会把 imCleanup 标成 done，后台补偿任务就再也不会捞到这条记录。
func TestForceLogoutAllRequiresConfiguredClient(t *testing.T) {
	c := newClient(config.OpenIMConfig{}, nil)
	if err := c.ForceLogoutAll(context.Background(), "u1"); err != ErrUnavailable {
		t.Fatalf("ForceLogoutAll error = %v, want ErrUnavailable", err)
	}
}

func TestAnonymizeUserRequiresConfiguredClient(t *testing.T) {
	c := newClient(config.OpenIMConfig{}, nil)
	if err := c.AnonymizeUser(context.Background(), "u1"); err == nil {
		t.Fatal("AnonymizeUser on an unconfigured client must fail")
	}
}
