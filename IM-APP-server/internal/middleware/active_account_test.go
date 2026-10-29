package middleware

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCanceledAccountCannotReuseValidAccessToken(t *testing.T) {
	token, err := IssueToken("test-secret", "user-1", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name   string
		active bool
		err    error
		want   int
	}{
		{"active", true, nil, 200}, {"canceled", false, nil, 401}, {"database failure", false, errors.New("offline"), 503},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()
			r.Use(AuthRequired("test-secret"), ActiveAccount(func(_ context.Context, id string) (bool, error) {
				if id != "user-1" {
					t.Fatal("incorrect subject")
				}
				return tt.active, tt.err
			}))
			r.GET("/private", func(c *gin.Context) { c.Status(200) })
			req := httptest.NewRequest(http.MethodGet, "/private", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tt.want {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}
