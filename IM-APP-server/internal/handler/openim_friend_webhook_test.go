package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"im-app-server/internal/repository"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
)

func TestFriendWebhookRejectsDirectSDKWrites(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, command := range []string{"callbackBeforeAddFriendCommand", "callbackBeforeAddFriendAgreeCommand"} {
		t.Run(command, func(t *testing.T) {
			h := &OpenIMWebhookHandler{
				Secret: "test-only-secret", AdminUser: "admin",
				Audit: &repository.IMAccessRepo{}, Access: &service.IMWebhookAccess{},
				AllowNets: parseAllowNets([]string{"127.0.0.1"}),
			}
			r := gin.New()
			r.POST("/hooks/:secret/"+command, h.BeforeFriendMutation)
			for _, body := range []string{`{"fromUserID":"caller","toUserID":"target"}`, `{"operatorUserID":"admin"}`, `{}`} {
				req := httptest.NewRequest(http.MethodPost, "/hooks/test-only-secret/"+command, strings.NewReader(body))
				req.RemoteAddr = "127.0.0.1:1234"
				res := httptest.NewRecorder()
				r.ServeHTTP(res, req)
				var payload openIMWebhookResponse
				if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				if res.Code != http.StatusOK || payload.ErrCode == 0 || payload.NextCode != 1 {
					t.Fatalf("direct friend write was not denied: status=%d body=%s", res.Code, res.Body.String())
				}
			}
			res := httptest.NewRecorder()
			r.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/hooks/wrong/"+command, nil))
			if res.Code != http.StatusNotFound {
				t.Fatalf("unauthorized callback status=%d", res.Code)
			}
		})
	}
}
