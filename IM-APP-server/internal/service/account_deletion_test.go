package service

import (
	"strings"
	"testing"

	"im-app-server/internal/models"
)

// 审计表严禁落明文个人数据，哈希函数必须稳定且不可逆。
func TestAccountDeletionHMACIsStableAndHidesPlaintext(t *testing.T) {
	svc := &AccountDeletionService{HashKey: "unit-test-key"}

	first := svc.hmacHex("+8613800138000")
	second := svc.hmacHex("+8613800138000")
	if first != second {
		t.Fatalf("hmacHex not deterministic: %q vs %q", first, second)
	}
	if strings.Contains(first, "13800138000") {
		t.Fatalf("hmacHex leaked plaintext: %q", first)
	}
	// 十六进制 SHA-256 = 64 字符
	if len(first) != 64 {
		t.Fatalf("hmacHex length = %d, want 64", len(first))
	}
	if svc.hmacHex("+8613800138001") == first {
		t.Fatal("hmacHex collision on different phone numbers")
	}
}

// 不同密钥下的哈希必须不同，否则换密钥后历史记录可被关联反推。
func TestAccountDeletionHMACDependsOnKey(t *testing.T) {
	a := (&AccountDeletionService{HashKey: "key-a"}).hmacHex("same")
	b := (&AccountDeletionService{HashKey: "key-b"}).hmacHex("same")
	if a == b {
		t.Fatal("hmacHex produced identical digest for different keys")
	}
}

// 未配置密钥时也要能出哈希（不能因为缺配置就让注销整个失败）。
func TestAccountDeletionHMACFallsBackWithoutKey(t *testing.T) {
	svc := &AccountDeletionService{}
	got := svc.hmacHex("+8613800138000")
	if len(got) != 64 {
		t.Fatalf("fallback hmacHex length = %d, want 64", len(got))
	}
}

func TestAccountDeletionBlockedErrorMessage(t *testing.T) {
	err := &AccountDeletionBlockedError{Blockers: []models.AccountDeletionBlocker{
		{Code: "group_owner"},
		{Code: "group_owner"},
	}}
	if !strings.Contains(err.Error(), "2") {
		t.Fatalf("Error() = %q, want it to mention the blocker count", err.Error())
	}
}
