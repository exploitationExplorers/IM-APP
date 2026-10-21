package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/config"
	"im-app-server/internal/infra"
)

func TestPrivateOSSMediaHTTPContract(t *testing.T) {
	o, err := infra.NewOSS(config.OSSConfig{Region: "cn-hangzhou", Bucket: "fake-business", AccessKeyID: "test-id", AccessKeySecret: "test-secret", KeyPrefix: "oss-test/business/", MediaProxyURL: "https://test.example/api/v1/public/oss-media", MediaSigningKey: strings.Repeat("test", 10)})
	if err != nil {
		t.Fatal(err)
	}
	key, _ := o.NewKey("uploads/a.jpg")
	stable, _ := url.Parse(o.FileURL(key))
	h := &FileHandler{Storage: &infra.Storage{OSS: o}}
	r := gin.New()
	r.GET("/api/v1/public/oss-media", h.OSSMedia)
	mediaCases := []struct {
		name        string
		objectKey   string
		variant     string
		status      int
		processWant string
	}{
		{name: "list", objectKey: key, variant: "list", status: http.StatusFound, processWant: "image/resize,w_360/quality,q_60/format,webp"},
		{name: "preview", objectKey: key, variant: "preview", status: http.StatusFound, processWant: "image/resize,w_1280/quality,q_75/format,webp"},
		{name: "preview_mobile", objectKey: key, variant: "preview-mobile", status: http.StatusFound, processWant: "image/resize,w_960/quality,q_72/format,webp"},
		{name: "avatar", objectKey: key, variant: "avatar", status: http.StatusFound, processWant: "image/resize,w_128/quality,q_70/format,webp"},
		{name: "invalid_variant", objectKey: key, variant: "original", status: http.StatusBadRequest},
		{name: "video_ignores_variant", objectKey: "oss-test/business/uploads/a.mp4", variant: "list", status: http.StatusFound},
	}
	for _, tc := range mediaCases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			caseStable := stable
			if tc.objectKey != key {
				caseStable, err = url.Parse(o.FileURL(tc.objectKey))
				if err != nil {
					t.Fatal(err)
				}
			}
			requestURL := caseStable.Path + "?key=" + url.QueryEscape(tc.objectKey) + "&token=" + url.QueryEscape(caseStable.Query().Get("token")) + "&variant=" + url.QueryEscape(tc.variant)
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, requestURL, nil))
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d", w.Code, tc.status)
			}
			if tc.status != http.StatusFound {
				return
			}
			location, err := url.Parse(w.Header().Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			if got := location.Query().Get("x-oss-process"); got != tc.processWant {
				t.Fatalf("x-oss-process = %q, want %q", got, tc.processWant)
			}
		})
	}

	for name, query := range map[string]string{
		"valid":    stable.RawQuery,
		"missing":  "",
		"tampered": "key=oss-test/business/uploads/b.jpg&token=" + url.QueryEscape(stable.Query().Get("token")),
		"outside":  "key=uploads/a.jpg&token=" + url.QueryEscape(stable.Query().Get("token")),
	} {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, stable.Path+"?"+query, nil))
			if name != "valid" {
				if w.Code != 404 {
					t.Fatal("invalid capability accepted")
				}
				return
			}
			if w.Code != 302 || !strings.Contains(w.Header().Get("Location"), "x-oss-signature=") || w.Header().Get("Cache-Control") != "private, no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
				t.Fatal("private media redirect contract changed")
			}
		})
	}
}
