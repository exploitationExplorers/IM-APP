package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/service"
)

func TestPrivacyUpdateRejectsMissingOrInvalidChoices(t *testing.T) {
	for _, body := range []string{
		`{}`, `null`, `{"requireFriendApproval":true}`, `{"requireGroupApproval":false}`,
		`{"requireFriendApproval":null,"requireGroupApproval":true}`,
		`{"requireFriendApproval":false,"requireGroupApproval":null}`,
		`{"requireFriendApproval":"false","requireGroupApproval":true}`,
		`{"requireFriendApproval":true,"requireGroupApproval":1}`,
	} {
		t.Run(body, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/me/privacy-settings", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			// 未配置 service，非法请求若到达写入层会立即使测试失败。
			(&UserHandler{}).UpdatePrivacySettings(c)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
}

func TestPrivacyUpdateAllowsExplicitFalse(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/me/privacy-settings", strings.NewReader(`{"requireFriendApproval":false,"requireGroupApproval":false}`))
	c.Request.Header.Set("Content-Type", "application/json")
	// 服务不可用应返回存储错误，不能把明确 false 当作缺失参数返回 400。
	(&UserHandler{Svc: &service.UserService{}}).UpdatePrivacySettings(c)
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "更新隐私设置失败") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
