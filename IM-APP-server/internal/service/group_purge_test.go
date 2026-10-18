package service

import "testing"

func TestGroupPurgeTipText(t *testing.T) {
	cases := []struct {
		role, nickname, want string
	}{
		{"owner", "小王", "群主清除了「小王」的全部消息"},
		{"admin", "  广告\n号  ", "管理员清除了「广告 号」的全部消息"},
		{"admin", "   ", "管理员清除了「该成员」的全部消息"},
	}
	for _, tc := range cases {
		if got := groupPurgeTipText(tc.role, tc.nickname); got != tc.want {
			t.Errorf("groupPurgeTipText(%q, %q) = %q, want %q", tc.role, tc.nickname, got, tc.want)
		}
	}
}
