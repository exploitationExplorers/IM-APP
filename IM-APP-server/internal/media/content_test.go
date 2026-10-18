package media

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestRewriteCrossPlatformMedia(t *testing.T) {
	for _, content := range []string{
		`https://chat.example/chat/a?signature=old`,
		`{"sourcePicture":{"url":"https://chat.example/chat/a?signature=old"},"snapshotPicture":{"url":"https://chat.example/chat/b"}}`,
		`{"VideoElem":{"VideoUrl":"https://chat.example/chat/a?signature=old","SnapshotUrl":"https://chat.example/chat/b","Duration":12},"Seq":9007199254740993}`,
		`{"path":"https://chat.example/chat/a?signature=old","duration":8,"localPath":"file:///tmp/audio"}`,
		`{"videoPath":"https://chat.example/chat/a?signature=old","snapshotPath":"https://chat.example/chat/b"}`,
		`{"quoteMessage":{"Content":"{\"FileElem\":{\"FileUrl\":\"https://chat.example/chat/a?signature=old\"}}"}}`,
		`"https://chat.example/chat/a?signature=old"`,
	} {
		t.Run(content[:min(30, len(content))], func(t *testing.T) {
			before, err := URLs(content)
			if err != nil || len(before) == 0 {
				t.Fatalf("URLs: %v", err)
			}
			out, n, err := Rewrite(context.Background(), content, func(_ context.Context, s string) (string, error) {
				return strings.ReplaceAll(s, "chat.example/chat/", "business.example/favorites/"), nil
			})
			if err != nil || n != len(before) || strings.Contains(out, "chat.example") {
				t.Fatalf("rewrite: %d %v", n, err)
			}
			if json.Valid([]byte(content)) && !json.Valid([]byte(out)) {
				t.Fatal("outer JSON shape lost")
			}
			if strings.Contains(content, "9007199254740993") && !strings.Contains(out, "9007199254740993") {
				t.Fatal("integer precision lost")
			}
			if strings.Contains(content, "VideoElem") && !strings.Contains(out, "VideoElem") {
				t.Fatal("native casing lost")
			}
			if strings.Contains(content, "file:///tmp/audio") && !strings.Contains(out, "file:///tmp/audio") {
				t.Fatal("local metadata rewritten")
			}
		})
	}
}

func TestRewriteBoundsAndFailures(t *testing.T) {
	for _, content := range []string{
		strings.Repeat("x", (64<<10)+1), `{"url":`,
		strings.Repeat("[", 18) + `"https://chat.example/a"` + strings.Repeat("]", 18),
		`[` + strings.Repeat(`"https://chat.example/a",`, 64) + `"https://chat.example/b"]`,
	} {
		if _, _, err := Rewrite(context.Background(), content, func(_ context.Context, s string) (string, error) { return s, nil }); err == nil {
			t.Fatal("invalid or excessive snapshot accepted")
		}
	}
	want := errors.New("copy failed")
	if _, _, err := Rewrite(context.Background(), "https://chat.example/a", func(context.Context, string) (string, error) { return "", want }); !errors.Is(err, want) {
		t.Fatal("copy failure lost")
	}
	urls, err := URLs(`{"path":"file:///tmp/a","url":"https://chat.example/a","URL":"https://chat.example/a","text":"https://unrelated.example/"}`)
	if err != nil || !reflect.DeepEqual(urls, []string{"https://chat.example/a"}) {
		t.Fatal("local paths/text/duplicates incorrectly collected")
	}
}

func TestRewritePreservesMetadataAndRejectsOversizedResult(t *testing.T) {
	content := `{"FileElem":{"FileUrl":"https://chat.example/chat/a","FileName":"[图片].jpg"},"caption":"{keep this text}","Seq":9007199254740993}`
	out, n, err := Rewrite(context.Background(), content, func(_ context.Context, raw string) (string, error) {
		return "https://business.example/favorites/a", nil
	})
	if err != nil || n != 1 || !strings.Contains(out, `"FileName":"[图片].jpg"`) || !strings.Contains(out, `"caption":"{keep this text}"`) || !strings.Contains(out, "9007199254740993") {
		t.Fatalf("metadata corrupted: %v", err)
	}
	if _, _, err := Rewrite(context.Background(), content, func(context.Context, string) (string, error) {
		return "https://example.com/" + strings.Repeat("a", MaxContentBytes), nil
	}); !errors.Is(err, ErrContent) {
		t.Fatal("oversized rewritten snapshot accepted")
	}
}
