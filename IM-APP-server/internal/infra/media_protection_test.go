package infra

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMediaProtectionNativeBodyAndFailClosed(t *testing.T) {
	key := strings.Repeat("k", 32)
	raw := `{"QuoteElem":{"QuoteMessage":{"Content":"{\"VideoElem\":{\"SnapshotUrl\":\"https://media.invalid/object/a\"}}"}}}`
	status, calls := 200, 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/internal/media-gc/protect" || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer "+key {
			t.Error("incorrect private request")
		}
		var req struct {
			Content string `json:"content"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil || req.Content != raw {
			t.Error("native snapshot altered")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"protocol":"im-app-media-gc-v1"}`))
	}))
	defer s.Close()
	p, err := NewMediaProtection(s.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	if p.Hold(context.Background(), raw) != nil || calls != 1 {
		t.Fatal("reference not protected")
	}
	for _, code := range []int{401, 403, 404, 409, 503} {
		status = code
		if p.Hold(context.Background(), raw) == nil {
			t.Fatal("outage must fail closed", code)
		}
	}
	before := calls
	if p.Hold(context.Background(), `{"text":"你好"}`) != nil || calls != before {
		t.Fatal("ordinary text depends on optional bridge")
	}
}

func TestMediaProtectionNeverFollowsRedirectOrUsesProxy(t *testing.T) {
	var forwarded bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded = true }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer origin.Close()
	p, _ := NewMediaProtection(origin.URL, strings.Repeat("k", 32))
	if p.client.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("private key could go through proxy")
	}
	if p.Hold(context.Background(), `"https://media.invalid/object/a"`) == nil || forwarded {
		t.Fatal("private bearer followed redirect")
	}
	for _, base := range []string{"", "file:///tmp/a", "https://u:p@a", "http://a/path", "http://a?x=1"} {
		if _, err := NewMediaProtection(base, strings.Repeat("k", 32)); err == nil {
			t.Fatal("invalid private endpoint accepted", base)
		}
	}
}
