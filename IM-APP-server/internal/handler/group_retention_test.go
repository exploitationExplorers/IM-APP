package handler

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/middleware"
	"im-app-server/internal/repository"
)

type retentionReaderSpy struct {
	calls int
	user  string
	ids   []string
	fail  bool
}

func (s *retentionReaderSpy) VisibilityForMember(_ context.Context, user string, ids []string) ([]repository.RetentionVisibility, error) {
	s.calls++
	s.user, s.ids = user, ids
	if s.fail {
		return nil, errors.New("do not expose private upstream details")
	}
	return nil, nil
}

func TestRetentionStatesHTTPContract(t *testing.T) {
	const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const id = "sg_11111111111141118111111111111111"
	spy := &retentionReaderSpy{}
	h := &GroupRetentionHandler{Reader: spy}
	r := gin.New()
	r.GET("/api/v1/im/group-retention/states", middleware.AuthRequired("test-only"), h.States)
	token, _ := middleware.IssueToken("test-only", user, time.Hour)
	for _, tc := range []struct {
		name, method, query, body string
		auth, fail                bool
		status                    int
	}{
		{"empty_state", "GET", "?conversationIds=" + id, "", true, false, 200},
		{"no_auth", "GET", "?conversationIds=" + id, "", false, false, 401},
		{"no_ids", "GET", "", "", true, false, 400},
		{"empty_ids", "GET", "?conversationIds=", "", true, false, 400},
		{"other_user", "GET", "?conversationIds=" + id + "&userId=other", "", true, false, 400},
		{"json_not_query", "GET", "?conversationIds=" + id, `{}`, true, false, 400},
		{"single_chat", "GET", "?conversationIds=si_x_y", "", true, false, 400},
		{"uppercase", "GET", "?conversationIds=sg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "", true, false, 400},
		{"duplicate", "GET", "?conversationIds=" + id + "," + id, "", true, false, 400},
		{"multiple_values", "GET", "?conversationIds=" + id + "&conversationIds=" + id, "", true, false, 400},
		{"too_many", "GET", "?conversationIds=" + strings.Repeat(id+",", 50) + id, "", true, false, 400},
		{"unavailable", "GET", "?conversationIds=" + id, "", true, true, 503},
		{"wrong_method", "POST", "?conversationIds=" + id, "", true, false, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := spy.calls
			spy.fail = tc.fail
			w := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, "/api/v1/im/group-retention/states"+tc.query, strings.NewReader(tc.body))
			if tc.auth {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.status, w.Body.String())
			}
			if tc.status == 200 {
				if spy.user != user || len(spy.ids) != 1 || spy.ids[0] != "11111111-1111-4111-8111-111111111111" {
					t.Fatal("identity/group binding lost")
				}
				if w.Header().Get("Cache-Control") != "private, no-store" || !strings.Contains(w.Body.String(), `"items":[]`) {
					t.Fatal("invalid empty state")
				}
			}
			if tc.status != 200 && tc.status != 503 && spy.calls != before {
				t.Fatal("invalid request reached repository")
			}
			if strings.Contains(w.Body.String(), "private upstream") {
				t.Fatal("upstream detail leaked")
			}
		})
	}
}
