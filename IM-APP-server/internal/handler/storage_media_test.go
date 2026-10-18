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
