package handler

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"im-app-server/internal/middleware"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type accountHandlerStub struct {
	calls int
	count int
	err   error
}

func (s *accountHandlerStub) Delete(_ context.Context, id, password string) error {
	s.calls++
	if id != "user-1" || password != "secret" {
		return errors.New("unexpected identity")
	}
	return s.err
}
func (s *accountHandlerStub) Cancel(context.Context, string, string) error { return s.err }
func (s *accountHandlerStub) OwnedGroupCount(context.Context, string) (int, error) {
	return s.count, s.err
}

func TestAccountDeletionValidatesJSONAndExplicitConsent(t *testing.T) {
	for _, body := range []string{`{}`, `{"password":"secret"}`, `{"password":"secret","confirmed":false}`, `{"password":1,"confirmed":true}`, `invalid`} {
		svc := &accountHandlerStub{}
		h := AccountHandler{Svc: svc}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/me/account/delete", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		h.Delete(c)
		if w.Code != 400 || svc.calls != 0 {
			t.Fatalf("%s: %d, calls=%d", body, w.Code, svc.calls)
		}
	}
	for _, tt := range []struct {
		err    error
		status int
	}{{nil, 200}, {service.ErrAccountPassword, 400}, {repository.ErrAccountOwnsGroups, 409}, {repository.ErrAccountChanged, 409}, {service.ErrForbidden, 401}, {errors.New("internal detail"), 503}} {
		svc := &accountHandlerStub{err: tt.err}
		h := AccountHandler{Svc: svc}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(middleware.ContextUserID, "user-1")
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/me/account/delete", strings.NewReader(`{"password":"secret","confirmed":true}`))
		c.Request.Header.Set("Content-Type", "application/json")
		h.Delete(c)
		if w.Code != tt.status || svc.calls != 1 {
			t.Fatalf("%v: %d %s", tt.err, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "internal detail") {
			t.Fatal("internal error leaked")
		}
	}
}

func TestAccountDeletionRequirementsAndCanceledSender(t *testing.T) {
	for _, count := range []int{0, 2} {
		h := AccountHandler{Accounts: &accountHandlerStub{count: count}}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/me/account-deletion", nil)
		h.Requirements(c)
		if w.Code != 200 || strings.Contains(w.Body.String(), `"canDelete":true`) != (count == 0) {
			t.Fatal(w.Body.String())
		}
	}
	h := OpenIMWebhookHandler{AccountActive: func(context.Context, string) (bool, error) { return false, nil }}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/callback", nil)
	if h.senderActive(c, "user-1") || w.Code != 200 || !strings.Contains(w.Body.String(), `"nextCode":1`) {
		t.Fatal(w.Body.String())
	}
}
