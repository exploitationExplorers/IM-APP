package middleware

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type testMediaProtector struct {
	err   error
	got   string
	calls int
}

func (p *testMediaProtector) Hold(_ context.Context, raw string) error {
	p.calls++
	p.got = raw
	return p.err
}
func TestProtectMediaPreservesNativeBytesAndFailsClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	p := &testMediaProtector{}
	r := gin.New()
	r.Use(ProtectMedia(p))
	r.POST("/write", func(c *gin.Context) { body, _ := io.ReadAll(c.Request.Body); c.Data(200, "application/json", body) })
	body := ` {"PictureElem":{"SourcePicture":{"Url":"https://media.invalid/a"}}} `
	for _, fail := range []bool{false, true} {
		p.err = nil
		if fail {
			p.err = errors.New("unavailable")
		}
		req := httptest.NewRequest("POST", "/write", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if p.got != body {
			t.Fatal("JSON was rewritten")
		}
		if fail {
			if w.Code != 503 {
				t.Fatal("unsafe write allowed")
			}
		} else if w.Code != 200 || w.Body.String() != body {
			t.Fatal("native body changed")
		}
	}
	p.err = nil
	before := p.calls
	req := httptest.NewRequest("POST", "/write", strings.NewReader("multipart bytes"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if p.calls != before || w.Body.String() != "multipart bytes" {
		t.Fatal("multipart upload consumed")
	}
	req = httptest.NewRequest("POST", "/write", strings.NewReader(strings.Repeat("x", (4<<20)+1)))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge || p.calls != before {
		t.Fatal("body limit bypassed")
	}
}
