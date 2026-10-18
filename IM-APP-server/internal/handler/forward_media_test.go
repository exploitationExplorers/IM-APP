package handler

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/middleware"
	"im-app-server/internal/service"
)

func TestForwardMediaHTTPContract(t *testing.T) {
	h := &ForwardHandler{Svc: &service.ForwardService{}}
	r := gin.New()
	r.POST("/api/v1/forward-media/preserve", middleware.AuthRequired("test-only"), h.PreserveMedia)
	token, err := middleware.IssueToken("test-only", "11111111-1111-4111-8111-111111111111", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	valid := `{"sourceSnapshot":{"contentType":101,"content":{"content":"hello"}}}`
	for _, tc := range []struct {
		name, method, query, body, contentType string
		auth                                   bool
		status                                 int
	}{
		{"text", "POST", "", valid, "application/json", true, 200},
		{"no_auth", "POST", "", valid, "application/json", false, 401},
		{"query_rejected", "POST", "?owner=other", valid, "application/json", true, 400},
		{"not_json", "POST", "", valid, "text/plain", true, 400},
		{"trailing_json", "POST", "", valid + `{}`, "application/json", true, 400},
		{"unknown_owner", "POST", "", `{"sourceSnapshot":{"contentType":101,"content":{"content":"hello"}},"userId":"other"}`, "application/json", true, 400},
		{"forged_flag", "POST", "", `{"sourceSnapshot":{"contentType":102,"content":{},"mediaArchived":true}}`, "application/json", true, 400},
		{"missing_snapshot", "POST", "", `{}`, "application/json", true, 400},
		{"unsupported_control", "POST", "", `{"sourceSnapshot":{"contentType":1001,"content":{}}}`, "application/json", true, 400},
		{"local_media", "POST", "", `{"sourceSnapshot":{"contentType":102,"content":{"sourcePath":"file:///tmp/a"}}}`, "application/json", true, 400},
		{"incomplete_video", "POST", "", `{"sourceSnapshot":{"contentType":104,"content":{"videoUrl":"https://chat.example/a"}}}`, "application/json", true, 400},
		{"nested_local_media", "POST", "", `{"sourceSnapshot":{"contentType":114,"content":{"quoteMessage":{"ContentType":105,"FileElem":{"FilePath":"file:///private/a"}}}}}`, "application/json", true, 400},
		{"unavailable_storage", "POST", "", `{"sourceSnapshot":{"contentType":102,"content":{"url":"https://chat.example/a?secret=hidden"}}}`, "application/json", true, 503},
		{"oversized", "POST", "", `{"sourceSnapshot":{"contentType":101,"content":{"content":"` + strings.Repeat("x", 128<<10) + `"}}}`, "application/json", true, 400},
		{"wrong_method", "GET", "", valid, "application/json", true, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, "/api/v1/forward-media/preserve"+tc.query, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", tc.contentType)
			if tc.auth {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.status, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "secret=hidden") {
				t.Fatal("source capability leaked")
			}
		})
	}
}
