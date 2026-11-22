package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"im-app-server/internal/config"
	"im-app-server/internal/im"
	"im-app-server/internal/repository"
)

func TestRecentMessagesResolvesMaxSeqWhenClientHasNoSeq(t *testing.T) {
	const callerBusiness = "11111111-1111-1111-1111-111111111111"
	const callerIM = "11111111111111111111111111111111"
	const peerIM = "22222222222222222222222222222222"
	const conversationID = "si_" + callerIM + "_" + peerIM
	var maxSeqCalls, pullCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/msg/get_conversations_has_read_and_max_seq":
			maxSeqCalls.Add(1)
			var body struct {
				UserID          string   `json:"userID"`
				ConversationIDs []string `json:"conversationIDs"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode max seq request: %v", err)
			}
			if body.UserID != callerIM || len(body.ConversationIDs) != 1 || body.ConversationIDs[0] != conversationID {
				t.Fatalf("unexpected max seq request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"seqs":{"` + conversationID + `":{"hasReadSeq":5,"maxSeq":42,"maxSeqTime":1700000000000}}}}`))
		case "/msg/pull_msg_by_seq":
			pullCalls.Add(1)
			var body struct {
				UserID    string `json:"userID"`
				SeqRanges []struct {
					ConversationID string `json:"conversationID"`
					Begin          int64  `json:"begin"`
					End            int64  `json:"end"`
					Num            int    `json:"num"`
				} `json:"seqRanges"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode pull request: %v", err)
			}
			if body.UserID != callerIM || len(body.SeqRanges) != 1 {
				t.Fatalf("unexpected pull request: %#v", body)
			}
			item := body.SeqRanges[0]
			if item.ConversationID != conversationID || item.Begin != 13 || item.End != 42 || item.Num != 30 {
				t.Fatalf("unexpected seq range: %#v", item)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"msgs":{"` + conversationID + `":{"Msgs":[{"clientMsgID":"m42","serverMsgID":"s42","sendID":"` + peerIM + `","recvID":"` + callerIM + `","senderNickname":"peer","contentType":101,"sendTime":1700000000000,"seq":42,"sessionType":1,"status":2,"content":{"content":"hello"}}]}}}}`))
		default:
			t.Fatalf("unexpected OpenIM path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	svc := &IMService{
		Client: im.NewClient(config.OpenIMConfig{APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin"}),
		Access: &repository.IMAccessRepo{},
	}
	rows, err := svc.RecentMessages(context.Background(), callerBusiness, []RecentMessageItem{{
		ConversationID: conversationID, EndSeq: 0, Count: 30,
	}})
	if err != nil {
		t.Fatalf("RecentMessages() error = %v", err)
	}
	if maxSeqCalls.Load() != 1 || pullCalls.Load() != 1 {
		t.Fatalf("max seq calls=%d pull calls=%d", maxSeqCalls.Load(), pullCalls.Load())
	}
	if len(rows) != 1 || rows[0].ConversationID != conversationID || len(rows[0].Messages) != 1 {
		t.Fatalf("unexpected rows: %#v", rows)
	}
	if rows[0].Messages[0].Seq != 42 || rows[0].Messages[0].Preview != "hello" {
		t.Fatalf("unexpected message: %#v", rows[0].Messages[0])
	}
}
