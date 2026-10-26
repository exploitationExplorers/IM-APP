package im

import (
	"context"
	"encoding/json"
	"im-app-server/internal/config"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCancelAccountOnlyClearsOwnMessagesAndLogsOutEveryPlatform(t *testing.T) {
	platforms := map[int]bool{}
	cleared := 0
	updated := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/auth/get_admin_token" {
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/user/update_user_info_ex" && body["userID"] != "canceled-user" {
			t.Errorf("wrong cleanup subject: %v", body)
		}
		switch r.URL.Path {
		case "/auth/force_logout":
			platforms[int(body["platformID"].(float64))] = true
		case "/user/update_user_info_ex":
			updated++
			info, ok := body["userInfo"].(map[string]any)
			if !ok || info["userID"] != "canceled-user" || info["nickname"] != "已注销用户" {
				t.Errorf("wrong anonymization scope: %v", body)
			}
		case "/msg/user_clear_all_msg":
			cleared++
			opt, ok := body["deleteSyncOpt"].(map[string]any)
			if !ok || opt["isSyncSelf"] != true || opt["isSyncOther"] != false {
				t.Errorf("unsafe clear scope: %v", body)
			}
		default:
			t.Errorf("unexpected cleanup endpoint: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"errCode":0,"data":{}}`))
	}))
	defer server.Close()
	client := newClient(config.OpenIMConfig{APIURL: server.URL, Secret: "test-secret", AdminUser: "imAdmin"}, server.Client())
	if err := client.CancelAccount(context.Background(), "canceled-user"); err != nil {
		t.Fatal(err)
	}
	if len(platforms) != 11 || cleared != 1 || updated != 1 {
		t.Fatal(platforms, cleared, updated)
	}
}
