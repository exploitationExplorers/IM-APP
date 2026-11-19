package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/middleware"
	"im-app-server/internal/service"
)

func TestGroupHistoryPreviewHTTPContract(t *testing.T) {
	const path = "/api/v1/im/group-history-previews"
	const item = "item=sg_11111111111141118111111111111111:20"
	secret := "preview-handler-test"
	h := &IMHandler{Service: &service.IMService{}}
	router := gin.New()
	router.GET(path, middleware.AuthRequired(secret), h.GroupHistoryPreviews)
	token, err := middleware.IssueToken(secret, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, query, body string
		withToken                 bool
		status                    int
	}{
		{"missing auth", "GET", item, "", false, 401},
		{"wrong method", "POST", item, "", true, 404},
		{"missing items", "GET", "", "", true, 400},
		{"exceeds batch limit", "GET", strings.Repeat(item+"&", service.GroupHistoryPreviewBatchSize) + item, "", true, 400},
		{"extra principal", "GET", item + "&userId=other", "", true, 400},
		{"duplicate", "GET", item + "&" + item, "", true, 400},
		{"body", "GET", item, `{}`, true, 400},
		{"direct chat", "GET", "item=si_1_2:20", "", true, 400},
		{"zero sequence", "GET", strings.ReplaceAll(item, ":20", ":0"), "", true, 400},
		{"valid reaches service", "GET", item, "", true, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, path+"?"+tc.query, strings.NewReader(tc.body))
			if tc.withToken {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.status, w.Body.String())
			}
			if w.Code == http.StatusServiceUnavailable && w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("preview response must never be cached by HTTP intermediaries")
			}
		})
	}
}
