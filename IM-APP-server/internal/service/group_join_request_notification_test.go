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

func TestSendGroupJoinRequestCardUsesAdminAndStableMessageID(t *testing.T) {
	var sends int
	var clientMsgIDs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":"3600"}}`))
		case "/msg/send_msg":
			if r.Header.Get("token") != "admin-token" {
				t.Fatalf("missing admin token")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["sendID"] != "imAdmin" || body["recvID"] != "22222222222242228222222222222222" {
				t.Fatalf("unexpected send target: %#v", body)
			}
			content := body["content"].(map[string]any)
			var payload map[string]any
			if err := json.Unmarshal([]byte(content["data"].(string)), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["businessKey"] != "group_join_request" ||
				payload["requestId"] != "request-1" ||
				payload["groupId"] != "qun_review" ||
				payload["applicantNickname"] != "申请人" {
				t.Fatalf("unexpected notification payload: %#v", payload)
			}
			clientMsgIDs = append(clientMsgIDs, body["clientMsgID"].(string))
			sends++
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"serverMsgID":"server-1","clientMsgID":"` +
				body["clientMsgID"].(string) + `"}}`))
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
		RequestID:       "request-1",
		GroupPublicID:   "qun_review",
		GroupName:       "审核群",
		ApplicantID:     "33333333-3333-4333-8333-333333333333",
		ApplicantName:   "申请人",
		ApplicantAvatar: "https://cdn.example/avatar.png",
	}
	recipient := "22222222-2222-4222-8222-222222222222"
	if err := service.sendGroupJoinRequestCard(context.Background(), recipient, card); err != nil {
		t.Fatal(err)
	}
	if err := service.sendGroupJoinRequestCard(context.Background(), recipient, card); err != nil {
		t.Fatal(err)
	}
	if sends != 2 {
		t.Fatalf("send calls=%d, want 2", sends)
	}
	if len(clientMsgIDs) != 2 || clientMsgIDs[0] == "" || clientMsgIDs[0] != clientMsgIDs[1] {
		t.Fatalf("clientMsgID must be stable across retries: %#v", clientMsgIDs)
	}
}
