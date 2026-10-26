package repository

import "testing"

func TestCleanupSettled(t *testing.T) {
	cases := []struct {
		status string
		want   bool
	}{
		{"done", true},
		{"failed", true},
		{"skipped", true},
		{"pending", false},
		{"", false},
		{"Done", false}, // 大小写敏感：状态值由本包写入，不做宽松匹配
	}
	for _, c := range cases {
		if got := cleanupSettled(c.status); got != c.want {
			t.Errorf("cleanupSettled(%q) = %v, want %v", c.status, got, c.want)
		}
	}
}

// MarkCleanup 曾因为同一个占位符既用于列赋值（varchar）又用于 IN 列表（text），
// 被 PostgreSQL 判为 inconsistent types deduced for parameter 而整条 UPDATE 失败，
// 审计状态永远停在 pending。这里守住「终态由 Go 侧判定、SQL 不再复用参数」的做法。
func TestCleanupSettledOnlyAcceptsTerminalStates(t *testing.T) {
	for _, s := range []string{"done", "failed", "skipped"} {
		if !cleanupSettled(s) {
			t.Fatalf("%q should be terminal", s)
		}
	}
	if cleanupSettled("pending") {
		t.Fatal("pending must not be terminal, otherwise backend compensation never runs")
	}
}
