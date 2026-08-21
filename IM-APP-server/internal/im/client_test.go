package im

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"

	"im-app-server/internal/config"
	"im-app-server/internal/models"
)

func TestGetUserTokenUsesCachedAdminToken(t *testing.T) {
	var adminCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			adminCalls.Add(1)
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["secret"] != "server-secret" || body["userID"] != "imAdmin" {
				t.Fatalf("unexpected admin token request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":"3600"}}`))
		case "/auth/get_user_token":
			if r.Header.Get("token") != "admin-token" {
				t.Fatalf("missing admin token header")
			}
			if r.Header.Get("operationID") == "" {
				t.Fatalf("missing operationID header")
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"user-token","expireTimeSeconds":7200}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	for range 2 {
		result, err := client.GetUserToken(context.Background(), "user-1", 5)
		if err != nil {
			t.Fatalf("GetUserToken() error = %v", err)
		}
		if result.Token != "user-token" || result.ExpireSec != 7200 || result.PlatformID != 5 {
			t.Fatalf("unexpected token result: %#v", result)
		}
	}
	if got := adminCalls.Load(); got != 1 {
		t.Fatalf("admin token calls = %d, want 1", got)
	}
}

func TestEnsureUserRegistersMissingUser(t *testing.T) {
	var checkCalls, registerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/user/account_check":
			checkCalls.Add(1)
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"results":[{"userID":"user-1","accountStatus":0}]}}`))
		case "/user/user_register":
			registerCalls.Add(1)
			var body struct {
				Users []User `json:"users"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if len(body.Users) != 1 || body.Users[0].FaceURL != models.DefaultAvatar {
				t.Fatalf("register users = %#v, want default faceURL", body.Users)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"failedUserIDs":[]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	err := client.EnsureUser(context.Background(), User{UserID: "user-1", Nickname: "Alice"})
	if err != nil {
		t.Fatalf("EnsureUser() error = %v", err)
	}
	if checkCalls.Load() != 1 || registerCalls.Load() != 1 {
		t.Fatalf("check calls=%d register calls=%d", checkCalls.Load(), registerCalls.Load())
	}
}

func TestBusinessErrorWithHTTP200IsReturned(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errCode":1001,"errMsg":"ArgsError","errDlt":"bad platform"}`))
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	_, err := client.GetAdminToken(context.Background())
	if err == nil {
		t.Fatal("GetAdminToken() error = nil, want API error")
	}
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.ErrCode != 1001 {
		t.Fatalf("error = %#v, want APIError code 1001", err)
	}
}

func TestInvalidPlatformRejectedBeforeNetwork(t *testing.T) {
	client := NewClient(config.OpenIMConfig{})
	_, err := client.GetUserToken(context.Background(), "user-1", 0)
	if err != ErrInvalidPlatform {
		t.Fatalf("error = %v, want ErrInvalidPlatform", err)
	}
}

func TestUserIDFromBusinessID(t *testing.T) {
	got, err := UserIDFromBusinessID("10223cf6-59ec-4556-8c09-141915e190ed")
	if err != nil {
		t.Fatalf("UserIDFromBusinessID() error = %v", err)
	}
	if got != "10223cf659ec45568c09141915e190ed" {
		t.Fatalf("UserIDFromBusinessID() = %q", got)
	}
	if _, err := UserIDFromBusinessID("not-a-uuid"); err != ErrInvalidUserID {
		t.Fatalf("invalid ID error = %v, want ErrInvalidUserID", err)
	}
	reversed, err := BusinessIDFromUserID(got)
	if err != nil || reversed != "10223cf6-59ec-4556-8c09-141915e190ed" {
		t.Fatalf("BusinessIDFromUserID() = %q, %v", reversed, err)
	}
	if _, err := BusinessIDFromUserID("external-openim-user"); err != ErrInvalidUserID {
		t.Fatalf("external ID error = %v, want ErrInvalidUserID", err)
	}
}

func TestSendBusinessNotificationUsesAdminToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/msg/send_business_notification":
			if r.Header.Get("token") != "admin-token" {
				t.Fatalf("missing admin token")
			}
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["recvUserID"] != "user-1" || body["key"] != "group_join_approved" || body["reliabilityLevel"] != float64(2) {
				t.Fatalf("unexpected request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"serverMsgID":"server-1","clientMsgID":"client-1","sendTime":123}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	result, err := client.SendBusinessNotification(context.Background(), "user-1", "", "group_join_approved", `{}`, true)
	if err != nil {
		t.Fatalf("SendBusinessNotification() error = %v", err)
	}
	if result.ServerMsgID != "server-1" || result.ClientMsgID != "client-1" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestSendForwardMessageDisablesOfflinePush(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/msg/send_msg":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			content, _ := body["content"].(map[string]any)
			if body["sendID"] != "sender" || body["recvID"] != "receiver" ||
				body["clientMsgID"] != "fwd-id" || body["notOfflinePush"] != true ||
				content["content"] != "hello" {
				t.Fatalf("unexpected request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"serverMsgID":"server-1","sendTime":123}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	result, err := client.SendForwardMessage(context.Background(), "sender", "receiver", "fwd-id", 101,
		json.RawMessage(`{"content":"hello"}`))
	if err != nil {
		t.Fatalf("SendForwardMessage() error = %v", err)
	}
	if result.ServerMsgID != "server-1" || result.ClientMsgID != "fwd-id" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestSendForwardGroupMessageUsesGroupSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/msg/send_msg":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["sendID"] != "sender" || body["groupID"] != "group" || body["recvID"] != nil ||
				body["sessionType"] != float64(3) || body["notOfflinePush"] != true {
				t.Fatalf("unexpected request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"serverMsgID":"server-1"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := newClient(config.OpenIMConfig{APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin"}, server.Client())
	result, err := client.SendForwardGroupMessage(context.Background(), "sender", "group", "fwd-group", 101,
		json.RawMessage(`{"content":"hello"}`))
	if err != nil {
		t.Fatalf("SendForwardGroupMessage() error = %v", err)
	}
	if result.ServerMsgID != "server-1" || result.ClientMsgID != "fwd-group" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestConversationSettingsUseV383API(t *testing.T) {
	var getCalls, setCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/conversation/get_conversations":
			getCalls.Add(1)
			var body struct {
				OwnerUserID     string   `json:"ownerUserID"`
				ConversationIDs []string `json:"conversationIDs"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode get conversations request: %v", err)
			}
			if body.OwnerUserID != "owner" || !reflect.DeepEqual(body.ConversationIDs, []string{"si_owner_peer"}) {
				t.Fatalf("unexpected get conversations request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"conversations":[{"conversationID":"si_owner_peer","conversationType":1,"ownerUserID":"owner","userID":"peer","recvMsgOpt":1,"isPinned":true,"isPrivateChat":true,"burnDuration":30,"msgDestructTime":3600,"isMsgDestruct":true,"groupAtType":2,"ex":"remark","draftText":"draft","attachedInfo":"meta"}]}}`))
		case "/conversation/set_conversations":
			setCalls.Add(1)
			var body struct {
				UserIDs      []string             `json:"userIDs"`
				Conversation ConversationSettings `json:"conversation"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode set conversations request: %v", err)
			}
			if !reflect.DeepEqual(body.UserIDs, []string{"owner"}) ||
				body.Conversation.ConversationID != "si_owner_peer" || body.Conversation.OwnerUserID != "owner" ||
				!body.Conversation.IsPrivateChat || body.Conversation.BurnDuration != 30 ||
				!body.Conversation.IsMsgDestruct || body.Conversation.MsgDestructTime != 3600 ||
				body.Conversation.Ex != "remark" || body.Conversation.DraftText != "draft" {
				t.Fatalf("unexpected set conversations request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0}`))
		default:
			t.Fatalf("unexpected OpenIM path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	items, err := client.GetConversations(context.Background(), "owner", []string{"si_owner_peer"})
	if err != nil {
		t.Fatalf("GetConversations() error = %v", err)
	}
	if len(items) != 1 || items[0].OwnerUserID != "owner" || items[0].RecvMsgOpt != 1 ||
		!items[0].IsPrivateChat || items[0].BurnDuration != 30 ||
		!items[0].IsMsgDestruct || items[0].MsgDestructTime != 3600 ||
		items[0].GroupAtType != 2 || items[0].Ex != "remark" ||
		items[0].DraftText != "draft" || items[0].AttachedInfo != "meta" {
		t.Fatalf("unexpected conversations: %#v", items)
	}
	if err := client.SetConversation(context.Background(), "owner", items[0]); err != nil {
		t.Fatalf("SetConversation() error = %v", err)
	}
	if getCalls.Load() != 1 || setCalls.Load() != 1 {
		t.Fatalf("get calls=%d set calls=%d", getCalls.Load(), setCalls.Load())
	}
}

func TestClearConversationMessagesOnlyClearsRequestingUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/msg/clear_conversation_msg":
			if r.Header.Get("token") != "admin-token" {
				t.Fatalf("missing admin token")
			}
			var body struct {
				UserID          string   `json:"userID"`
				ConversationIDs []string `json:"conversationIDs"`
				DeleteSyncOpt   struct {
					IsSyncSelf  bool `json:"isSyncSelf"`
					IsSyncOther bool `json:"isSyncOther"`
				} `json:"deleteSyncOpt"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode clear conversation request: %v", err)
			}
			if body.UserID != "owner" || !reflect.DeepEqual(body.ConversationIDs, []string{"si_owner_peer"}) ||
				!body.DeleteSyncOpt.IsSyncSelf || body.DeleteSyncOpt.IsSyncOther {
				t.Fatalf("unexpected clear conversation request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0}`))
		default:
			t.Fatalf("unexpected OpenIM path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	if err := client.ClearConversationMessages(context.Background(), "owner", []string{"si_owner_peer"}); err != nil {
		t.Fatalf("ClearConversationMessages() error = %v", err)
	}
}

func TestCreateConversationUsesV383SetConversations(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/conversation/set_conversations":
			var body struct {
				UserIDs      []string `json:"userIDs"`
				Conversation struct {
					ConversationID   string `json:"conversationID"`
					ConversationType int    `json:"conversationType"`
					OwnerUserID      string `json:"ownerUserID"`
					UserID           string `json:"userID"`
					GroupID          string `json:"groupID"`
				} `json:"conversation"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode create conversation request: %v", err)
			}
			if !reflect.DeepEqual(body.UserIDs, []string{"owner"}) ||
				body.Conversation.ConversationID != "si_owner_peer" ||
				body.Conversation.ConversationType != 1 || body.Conversation.OwnerUserID != "owner" ||
				body.Conversation.UserID != "peer" || body.Conversation.GroupID != "" {
				t.Fatalf("unexpected create conversation request: %#v", body)
			}
			_, _ = w.Write([]byte(`{"errCode":0}`))
		default:
			t.Fatalf("unexpected OpenIM path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "server-secret", AdminUser: "imAdmin",
	}, server.Client())
	if err := client.CreateConversation(context.Background(), "owner", "si_owner_peer", 1, "peer", ""); err != nil {
		t.Fatalf("CreateConversation() error = %v", err)
	}
}

func TestGroupModerationRequests(t *testing.T) {
	paths := make([]string, 0)
	var nicknameBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/auth/get_admin_token" {
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
			return
		}
		if r.Header.Get("token") != "admin-token" {
			t.Fatal("missing admin token")
		}
		paths = append(paths, r.URL.Path)
		if r.URL.Path == "/group/set_group_member_info" && len(paths) == 2 {
			if err := json.NewDecoder(r.Body).Decode(&nicknameBody); err != nil {
				t.Fatalf("decode nickname request: %v", err)
			}
		}
		_, _ = w.Write([]byte(`{"errCode":0}`))
	}))
	defer server.Close()
	client := newClient(config.OpenIMConfig{APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin"}, server.Client())
	ctx := context.Background()
	checks := []func() error{
		func() error { return client.SetGroupMemberRole(ctx, "group-1", "user-1", 60) },
		func() error { return client.SetGroupMemberNickname(ctx, "group-1", "user-1", "群昵称") },
		func() error { return client.SetGroupMemberMute(ctx, "group-1", "user-1", 30) },
		func() error { return client.SetGroupMemberMute(ctx, "group-1", "user-1", 0) },
		func() error { return client.SetGroupMute(ctx, "group-1", true) },
		func() error { return client.SetGroupMute(ctx, "group-1", false) },
		func() error { return client.DismissGroup(ctx, "group-1") },
	}
	for _, check := range checks {
		if err := check(); err != nil {
			t.Fatalf("group request failed: %v", err)
		}
	}
	want := []string{
		"/group/set_group_member_info", "/group/set_group_member_info", "/group/mute_group_member",
		"/group/cancel_mute_group_member", "/group/mute_group",
		"/group/cancel_mute_group", "/group/dismiss_group",
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("paths = %#v, want %#v", paths, want)
	}
	members, ok := nicknameBody["members"].([]any)
	if !ok || len(members) != 1 {
		t.Fatalf("nickname request members = %#v", nicknameBody["members"])
	}
	member, ok := members[0].(map[string]any)
	if !ok || member["nickName"] != "群昵称" {
		t.Fatalf("nickname request member = %#v", members[0])
	}
}

func TestUpdateGroupOnlySendsChangedFields(t *testing.T) {
	var request map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/group/set_group_info_ex":
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode group update request: %v", err)
			}
			_, _ = w.Write([]byte(`{"errCode":0}`))
		default:
			t.Fatalf("unexpected OpenIM path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin"}, server.Client())
	avatar := "https://example.test/group.png"
	allow := false
	if err := client.UpdateGroup(context.Background(), "group-1", GroupUpdate{
		FaceURL: &avatar, AllowMemberAddFriend: &allow,
	}); err != nil {
		t.Fatalf("UpdateGroup() error = %v", err)
	}
	if request["groupID"] != "group-1" || request["faceURL"] != avatar || request["applyMemberFriend"] != float64(1) {
		t.Fatalf("unexpected group update request: %#v", request)
	}
	if _, exists := request["groupName"]; exists {
		t.Fatalf("groupName must be omitted for a non-name update: %#v", request)
	}
	if _, exists := request["notification"]; exists {
		t.Fatalf("notification must be omitted when unchanged: %#v", request)
	}
}

func TestEnsureExistingGroupDoesNotWriteProfile(t *testing.T) {
	var updateCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
		case "/group/get_groups_info":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"groupInfos":[{"groupID":"group-1"}]}}`))
		case "/group/set_group_info_ex", "/group/create_group":
			updateCalls.Add(1)
			_, _ = w.Write([]byte(`{"errCode":0}`))
		default:
			t.Fatalf("unexpected OpenIM path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newClient(config.OpenIMConfig{APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin"}, server.Client())
	if err := client.EnsureGroup(context.Background(), Group{GroupID: "group-1", GroupName: "群聊"}); err != nil {
		t.Fatalf("EnsureGroup() error = %v", err)
	}
	if got := updateCalls.Load(); got != 0 {
		t.Fatalf("existing group profile write calls = %d, want 0", got)
	}
}

func TestListGroupMemberIDsPaginates(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/auth/get_admin_token" {
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":3600}}`))
			return
		}
		calls++
		if calls == 1 {
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"total":2,"members":[{"userID":"u1"}]}}`))
		} else {
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"total":2,"members":[{"userID":"u2"}]}}`))
		}
	}))
	defer server.Close()
	client := newClient(config.OpenIMConfig{APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin"}, server.Client())
	got, err := client.ListGroupMemberIDs(context.Background(), "group-1")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || !reflect.DeepEqual(got, []string{"u1", "u2"}) {
		t.Fatalf("calls=%d members=%#v", calls, got)
	}
}
