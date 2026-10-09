package middleware

import "testing"

func TestSanitizeWebhookPath(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{
			"/internal/openim/webhooks/a2eb273a0fc30c05265884ecc4ab564d96026953fb4d1f29/callbackBeforeSendSingleMsgCommand",
			"/internal/openim/webhooks/***/callbackBeforeSendSingleMsgCommand",
		},
		{
			"/internal/openim/webhooks/secret/callbackAfterSendGroupMsgCommand",
			"/internal/openim/webhooks/***/callbackAfterSendGroupMsgCommand",
		},
		// 只有前缀没有 callback 段时也要脱敏
		{"/internal/openim/webhooks/secret", "/internal/openim/webhooks/***"},
		// 非 webhook 路径原样返回
		{"/health", "/health"},
		{"/internal/im/health", "/internal/im/health"},
		// 前缀只是子串，不能被误伤
		{"/x/internal/openim/webhooks/secret/callback", "/x/internal/openim/webhooks/secret/callback"},
	}

	for _, tc := range cases {
		if got := SanitizeWebhookPath(tc.in); got != tc.want {
			t.Fatalf("SanitizeWebhookPath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestSanitizeWebhookPathDropsSecret 确保密钥绝对不会出现在日志里。
func TestSanitizeWebhookPathDropsSecret(t *testing.T) {
	const secret = "a2eb273a0fc30c05265884ecc4ab564d96026953fb4d1f29"
	got := SanitizeWebhookPath("/internal/openim/webhooks/" + secret + "/callbackBeforeSendGroupMsgCommand")
	if got == "" {
		t.Fatal("empty result")
	}
	for i := 0; i+8 <= len(secret); i++ {
		if contains(got, secret[i:i+8]) {
			t.Fatalf("sanitized path 仍含密钥片段 %q: %s", secret[i:i+8], got)
		}
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
