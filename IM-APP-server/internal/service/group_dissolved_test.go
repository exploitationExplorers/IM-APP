package service

import (
	"context"
	"errors"
	"testing"

	"im-app-server/internal/repository"
)

// 已解散群接口：非法群号在访问 DB 前即被拒绝（合法形态为 qun_xxx 或遗留纯数字）。
func TestDissolvedGroupRejectsInvalidPublicID(t *testing.T) {
	svc := &GroupService{}
	ctx := context.Background()
	uid := "10223cf6-59ec-4556-8c09-141915e190ed"

	if _, err := svc.GetDissolvedInfo(ctx, "abc"); !errors.Is(err, repository.ErrInvalidGroupOperation) {
		t.Fatalf("GetDissolvedInfo('abc') error = %v, want ErrInvalidGroupOperation", err)
	}
	if err := svc.RemoveDissolvedGroup(ctx, "abc", uid); !errors.Is(err, repository.ErrInvalidGroupOperation) {
		t.Fatalf("RemoveDissolvedGroup('abc') error = %v, want ErrInvalidGroupOperation", err)
	}
	if _, err := svc.GetDissolvedInfo(ctx, "qun_"); !errors.Is(err, repository.ErrInvalidGroupOperation) {
		t.Fatalf("GetDissolvedInfo('qun_') error = %v, want ErrInvalidGroupOperation", err)
	}
}
