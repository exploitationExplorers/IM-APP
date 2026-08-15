package infra

import "testing"

func TestEscapeObjectKeyPreservesPathSeparators(t *testing.T) {
	got := escapeObjectKey("uploads/user id/举报 图片.jpg")
	want := "uploads/user%20id/%E4%B8%BE%E6%8A%A5%20%E5%9B%BE%E7%89%87.jpg"
	if got != want {
		t.Fatalf("escapeObjectKey() = %q, want %q", got, want)
	}
}
