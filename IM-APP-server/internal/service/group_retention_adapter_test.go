package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"im-app-server/internal/media"
	"im-app-server/internal/repository"
)

func TestRetentionAdapterConfiguration(t *testing.T) {
	a, err := NewRetentionHTTPAdapter("http://openim-api:19093", strings.Repeat("x", 32))
	if err != nil || a.client.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("internal adapter must bypass environment proxies")
	}
	for _, endpoint := range []string{"", "file:///tmp/x", "https://user:pass@example.com", "http://example.com/path", "http://example.com?secret=x", "http://example.com/#fragment"} {
		if _, err := NewRetentionHTTPAdapter(endpoint, strings.Repeat("x", 32)); err == nil {
			t.Fatalf("accepted unsafe endpoint %q", endpoint)
		}
	}
	for _, key := range []string{"", "short", strings.Repeat("x", 32) + "\r\n"} {
		if _, err := NewRetentionHTTPAdapter("http://127.0.0.1:19093", key); err == nil {
			t.Fatal("accepted invalid key")
		}
	}
}

func TestRetentionAdapterProtocolAndReceipts(t *testing.T) {
	const group = "aabbccdd-1122-3344-5566-778899aabbcc"
	const conversation = "sg_aabbccdd112233445566778899aabbcc"
	const receipt = "aabbccdd-1122-4344-8566-778899aabbcc"
	key := strings.Repeat("x", 32)
	var behavior string
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer "+key {
			t.Error("missing private authentication")
		}
		if behavior == "redirect" {
			http.Redirect(w, r, "/secret", 302)
			return
		}
		if behavior == "upstream_error" {
			http.Error(w, "sensitive upstream credential", 503)
			return
		}
		switch r.URL.Path {
		case "/internal/retention/capabilities":
			protocol := RetentionAdapterProtocol
			if behavior == "incompatible" {
				protocol = "unknown"
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"protocol": protocol, "mode": "visibility_only"})
		case "/internal/retention/snapshot":
			if r.URL.Query().Get("groupId") != "aabbccdd112233445566778899aabbcc" || r.Method != "GET" ||
				r.URL.Query().Get("maxMessages") == "" || r.URL.Query().Get("keepHours") == "" {
				t.Error("invalid snapshot query")
			}
			cid := conversation
			if behavior == "foreign" {
				cid = "sg_" + strings.Repeat("b", 32)
			}
			_ = json.NewEncoder(w).Encode(media.RetentionSnapshot{SnapshotID: receipt, ConversationID: cid, SessionType: "group", Watermark: 0, ServerTime: time.Now(), Complete: true})
		case "/internal/retention/apply":
			if r.Method != "POST" || r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/json" {
				t.Error("invalid apply request")
			}
			var req map[string]any
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req["snapshotId"] != receipt || req["conversationId"] != conversation || req["minVisibleSeq"] != float64(2) {
				t.Error("receipt not bound")
			}
			boundary := 2
			if behavior == "bad_ack" {
				boundary = 1
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"protocol": RetentionAdapterProtocol, "conversationId": conversation, "minVisibleSeq": boundary})
		default:
			t.Error("unexpected route")
		}
	}))
	defer srv.Close()
	a, err := NewRetentionHTTPAdapter(srv.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := a.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Snapshot(ctx, group, media.DefaultRetentionPolicy()); err != nil {
		t.Fatal(err)
	}
	job := repository.RetentionApplication{GroupID: group, Plan: media.RetentionPlan{Mode: "preview_only", SnapshotID: receipt, ConversationID: conversation,
		Watermark: 2, Kept: []int64{2}, Candidates: []media.RetentionCandidate{{Seq: 1, OverAge: true, OverCount: true}}}}
	if err := a.ApplyPrefix(ctx, job, 2); err != nil {
		t.Fatal(err)
	}
	before := requests
	if err := a.ApplyPrefix(ctx, job, 3); err == nil || before != requests {
		t.Fatal("unplanned boundary reached adapter")
	}
	for _, mode := range []string{"incompatible", "redirect", "upstream_error"} {
		behavior = mode
		if err := a.Check(ctx); !errors.Is(err, ErrRetentionAdapter) || strings.Contains(err.Error(), "credential") {
			t.Fatal("unsafe adapter failure")
		}
	}
	behavior = "foreign"
	if _, err := a.Snapshot(ctx, group, media.DefaultRetentionPolicy()); err == nil {
		t.Fatal("accepted foreign group snapshot")
	}
	behavior = "bad_ack"
	if err := a.ApplyPrefix(ctx, job, 2); err == nil {
		t.Fatal("accepted incomplete ACK")
	}
}
