package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestInternalAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(InternalAPIKey("server-key"))
	router.GET("/health", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	for _, test := range []struct {
		name string
		key  string
		want int
	}{
		{name: "missing", want: http.StatusUnauthorized},
		{name: "wrong", key: "wrong", want: http.StatusUnauthorized},
		{name: "valid", key: "server-key", want: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/health", nil)
			if test.key != "" {
				req.Header.Set("X-Internal-API-Key", test.key)
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)
			if resp.Code != test.want {
				t.Fatalf("status = %d, want %d", resp.Code, test.want)
			}
		})
	}
}
