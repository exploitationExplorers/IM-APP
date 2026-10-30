package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"im-app-server/internal/config"
	"im-app-server/internal/im"
	"im-app-server/internal/repository"
)

func TestSendGroupJoinRequestNotificationUsesBusinessNotification(t *testing.T) {
	var sends int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":"3600"}}`))
		case "/msg/send_business_notification":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["sendUserID"] != "imAdmin" ||
				body["recvUserID"] != "22222222222242228222222222222222" ||
				body["key"] != "group_join_request" ||
				body["reliabilityLevel"] != float64(2) {
				t.Fatalf("unexpected business notification body: %#v", body)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(body["data"].(string)), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["requestId"] != "request-1" ||
				payload["groupId"] != "qun_review" ||
				payload["groupConversationId"] != "sg_22222222222242228222222222222222" ||
				payload["applicantNickname"] != "申请人" {
				t.Fatalf("unexpected notification payload: %#v", payload)
			}
			sends++
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"serverMsgID":"server-1","clientMsgID":"client-1"}}`))
		case "/msg/send_msg":
			t.Fatal("join request must not create a C2C conversation")
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := im.NewClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin",
	})
	service := &GroupService{IM: client}
	card := repository.PendingGroupJoinRequestNotification{
		RequestID:           "request-1",
		GroupPublicID:       "qun_review",
		GroupConversationID: "sg_22222222222242228222222222222222",
		GroupName:           "审核群",
		ApplicantID:         "33333333-3333-4333-8333-333333333333",
		ApplicantName:       "申请人",
		ApplicantAvatar:     "https://cdn.example/avatar.png",
	}
	recipient := "22222222-2222-4222-8222-222222222222"
	if err := service.sendGroupJoinRequestNotification(context.Background(), recipient, card); err != nil {
		t.Fatal(err)
	}
	if sends != 1 {
		t.Fatalf("send calls=%d, want 1", sends)
	}
}
