package im

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"im-app-server/internal/config"
	"im-app-server/internal/models"
)

const maxResponseBytes = 2 << 20

var (
	ErrUnavailable          = errors.New("openim is not configured")
	ErrInvalidPlatform      = errors.New("invalid OpenIM platform ID")
	ErrInvalidUserID        = errors.New("invalid business user ID")
	ErrConversationNotFound = errors.New("openim conversation not found")
)

// UserIDFromBusinessID converts the PostgreSQL UUID into an OpenIM-compatible
// identifier. OpenIM user_register rejects UUID hyphens as special characters.
func UserIDFromBusinessID(businessUserID string) (string, error) {
	id, err := uuid.Parse(businessUserID)
	if err != nil {
		return "", ErrInvalidUserID
	}
	return strings.ReplaceAll(id.String(), "-", ""), nil
}

// BusinessIDFromUserID reverses the deterministic UUID mapping used by this
// service. It rejects arbitrary OpenIM accounts that do not belong to the app.
func BusinessIDFromUserID(openIMUserID string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(openIMUserID))
	if len(normalized) != 32 {
		return "", ErrInvalidUserID
	}
	id, err := uuid.Parse(normalized)
	if err != nil || strings.ReplaceAll(id.String(), "-", "") != normalized {
		return "", ErrInvalidUserID
	}
	return id.String(), nil
}

// APIError is an error returned by the OpenIM HTTP API. OpenIM can report an
// error with HTTP 200, so callers must check ErrCode instead of HTTP alone.
type APIError struct {
	HTTPStatus int
	ErrCode    int
	ErrMsg     string
	ErrDlt     string
}

func (e *APIError) Error() string {
	if e.ErrCode != 0 {
		return fmt.Sprintf("openim API error: code=%d message=%s detail=%s", e.ErrCode, e.ErrMsg, e.ErrDlt)
	}
	return fmt.Sprintf("openim HTTP error: status=%d message=%s", e.HTTPStatus, e.ErrMsg)
}

type Client struct {
	cfg    config.OpenIMConfig
	client *http.Client

	adminMu        sync.Mutex
	adminToken     string
	adminExpiresAt time.Time
}

func NewClient(cfg config.OpenIMConfig) *Client {
	return newClient(cfg, &http.Client{Timeout: 10 * time.Second})
}

func newClient(cfg config.OpenIMConfig, httpClient *http.Client) *Client {
	return &Client{cfg: cfg, client: httpClient}
}

func (c *Client) Available() bool {
	return c != nil && strings.TrimSpace(c.cfg.APIURL) != "" && c.cfg.Secret != "" && c.cfg.AdminUser != ""
}

type User struct {
	UserID   string `json:"userID"`
	Nickname string `json:"nickname"`
	FaceURL  string `json:"faceURL"`
}

type Group struct {
	GroupID              string
	GroupName            string
	Notification         string
	FaceURL              string
	OwnerUserID          string
	MemberUserIDs        []string
	AdminUserIDs         []string
	AllowMemberAddFriend bool
}

// GroupMemberLite 群成员的最小字段集，用于已读状态计算（joinTime 判断成员是否晚于消息入群）。
type GroupMemberLite struct {
	UserID   string `json:"userID"`
	JoinTime int64  `json:"joinTime"` // 毫秒时间戳
}

// GroupUpdate is intentionally sparse. OpenIM emits a persisted group notice
// for every field present in set_group_info_ex, even when the supplied value is
// unchanged. Callers must therefore only set fields changed by the user.
type GroupUpdate struct {
	GroupName            *string
	Notification         *string
	FaceURL              *string
	AllowMemberAddFriend *bool
}

type SendMessageResult struct {
	ServerMsgID string `json:"serverMsgID"`
	ClientMsgID string `json:"clientMsgID"`
	SendTime    int64  `json:"sendTime"`
}

type TokenResult struct {
	Token      string `json:"token"`
	ExpireSec  int    `json:"expireSec"`
	PlatformID int    `json:"platformId"`
	UserID     string `json:"userId"`
}

type flexInt int

func (i *flexInt) UnmarshalJSON(raw []byte) error {
	var number int
	if err := json.Unmarshal(raw, &number); err == nil {
		*i = flexInt(number)
		return nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return err
	}
	_, err := fmt.Sscan(text, &number)
	if err == nil {
		*i = flexInt(number)
	}
	return err
}

type responseEnvelope struct {
	ErrCode int             `json:"errCode"`
	ErrMsg  string          `json:"errMsg"`
	ErrDlt  string          `json:"errDlt"`
	Data    json.RawMessage `json:"data"`
}

// GetAdminToken returns a cached OpenIM administrator token and refreshes it
// before expiry. The secret is only ever sent to this endpoint.
func (c *Client) GetAdminToken(ctx context.Context) (string, error) {
	if !c.Available() {
		return "", ErrUnavailable
	}

	c.adminMu.Lock()
	defer c.adminMu.Unlock()
	if c.adminToken != "" && time.Until(c.adminExpiresAt) > 5*time.Minute {
		return c.adminToken, nil
	}

	var data struct {
		Token             string  `json:"token"`
		ExpireTimeSeconds flexInt `json:"expireTimeSeconds"`
	}
	err := c.post(ctx, "/auth/get_admin_token", "", map[string]any{
		"secret": c.cfg.Secret,
		"userID": c.cfg.AdminUser,
	}, &data)
	if err != nil {
		return "", err
	}
	if data.Token == "" {
		return "", errors.New("openim admin token response is empty")
	}
	expires := int(data.ExpireTimeSeconds)
	if expires <= 0 {
		expires = 3600
	}
	c.adminToken = data.Token
	c.adminExpiresAt = time.Now().Add(time.Duration(expires) * time.Second)
	return c.adminToken, nil
}

func (c *Client) RegisterUsers(ctx context.Context, users []User) error {
	if len(users) == 0 {
		return nil
	}
	var data struct {
		FailedUserIDs []string `json:"failedUserIDs"`
	}
	if err := c.postWithAdmin(ctx, "/user/user_register", map[string]any{"users": users}, &data); err != nil {
		return err
	}
	if len(data.FailedUserIDs) > 0 {
		return fmt.Errorf("openim failed to register %d user(s)", len(data.FailedUserIDs))
	}
	return nil
}

func (c *Client) UpdateUser(ctx context.Context, user User) error {
	return c.postWithAdmin(ctx, "/user/update_user_info_ex", map[string]any{"userInfo": user}, nil)
}

func (c *Client) IsUserRegistered(ctx context.Context, userID string) (bool, error) {
	var data struct {
		Results []struct {
			UserID        string `json:"userID"`
			AccountStatus int    `json:"accountStatus"`
		} `json:"results"`
	}
	if err := c.postWithAdmin(ctx, "/user/account_check", map[string]any{
		"checkUserIDs": []string{userID},
	}, &data); err != nil {
		return false, err
	}
	for _, result := range data.Results {
		if result.UserID == userID {
			return result.AccountStatus == 1, nil
		}
	}
	// OpenIM 对未注册账号可能省略 results 项，按未注册处理以便补注册。
	return false, nil
}

// EnsureUser makes PostgreSQL's user visible to OpenIM and keeps the OpenIM
// nickname/avatar current. account_check makes retries idempotent.
func (c *Client) EnsureUser(ctx context.Context, user User) error {
	if strings.TrimSpace(user.FaceURL) == "" {
		user.FaceURL = models.DefaultAvatar
	}
	registered, err := c.IsUserRegistered(ctx, user.UserID)
	if err != nil {
		return err
	}
	if !registered {
		if err := c.RegisterUsers(ctx, []User{user}); err != nil {
			// Another worker/session may register the account after account_check.
			nowRegistered, checkErr := c.IsUserRegistered(ctx, user.UserID)
			if checkErr == nil && nowRegistered {
				return c.UpdateUser(ctx, user)
			}
			return err
		}
		return nil
	}
	return c.UpdateUser(ctx, user)
}

// EnsureUsersBatch registers missing users in chunks; existing accounts are updated individually.
func (c *Client) EnsureUsersBatch(ctx context.Context, users []User) error {
	if len(users) == 0 {
		return nil
	}
	for i := range users {
		if strings.TrimSpace(users[i].FaceURL) == "" {
			users[i].FaceURL = models.DefaultAvatar
		}
	}
	const chunkSize = 50
	for start := 0; start < len(users); start += chunkSize {
		end := start + chunkSize
		if end > len(users) {
			end = len(users)
		}
		chunk := users[start:end]
		if err := c.RegisterUsers(ctx, chunk); err != nil {
			for _, user := range chunk {
				if err := c.EnsureUser(ctx, user); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (c *Client) GetUserToken(ctx context.Context, userID string, platformID int) (TokenResult, error) {
	if platformID < 1 || platformID > 11 {
		return TokenResult{}, ErrInvalidPlatform
	}
	var data struct {
		Token             string  `json:"token"`
		ExpireTimeSeconds flexInt `json:"expireTimeSeconds"`
	}
	err := c.postWithAdmin(ctx, "/auth/get_user_token", map[string]any{
		"userID": userID, "platformID": platformID,
	}, &data)
	if err != nil {
		return TokenResult{}, err
	}
	if data.Token == "" {
		return TokenResult{}, errors.New("openim user token response is empty")
	}
	return TokenResult{
		Token: data.Token, ExpireSec: int(data.ExpireTimeSeconds),
		PlatformID: platformID, UserID: userID,
	}, nil
}

func (c *Client) ImportFriends(ctx context.Context, ownerUserID string, friendUserIDs []string) error {
	if len(friendUserIDs) == 0 {
		return nil
	}
	return c.postWithAdmin(ctx, "/friend/import_friend", map[string]any{
		"ownerUserID": ownerUserID, "friendUserIDs": friendUserIDs,
	}, nil)
}

func (c *Client) DeleteFriend(ctx context.Context, ownerUserID, friendUserID string) error {
	err := c.postWithAdmin(ctx, "/friend/delete_friend", map[string]any{
		"ownerUserID": ownerUserID, "friendUserID": friendUserID,
	}, nil)
	return ignoreNotFound(err)
}

func (c *Client) AddBlack(ctx context.Context, ownerUserID, blackUserID string) error {
	err := c.postWithAdmin(ctx, "/friend/add_black", map[string]any{
		"ownerUserID": ownerUserID, "blackUserID": blackUserID, "ex": "",
	}, nil)
	return ignoreAlreadyDesired(err)
}

func (c *Client) RemoveBlack(ctx context.Context, ownerUserID, blackUserID string) error {
	err := c.postWithAdmin(ctx, "/friend/remove_black", map[string]any{
		"ownerUserID": ownerUserID, "blackUserID": blackUserID,
	}, nil)
	return ignoreNotFound(err)
}

func (c *Client) IsGroupRegistered(ctx context.Context, groupID string) (bool, error) {
	var data struct {
		GroupInfos []struct {
			GroupID string `json:"groupID"`
		} `json:"groupInfos"`
	}
	err := c.postWithAdmin(ctx, "/group/get_groups_info", map[string]any{
		"groupIDs": []string{groupID},
	}, &data)
	if isNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, group := range data.GroupInfos {
		if group.GroupID == groupID {
			return true, nil
		}
	}
	return false, nil
}

func (c *Client) ListGroupMemberIDs(ctx context.Context, groupID string) ([]string, error) {
	const pageSize = 1000
	members := make([]string, 0)
	for page := 1; ; page++ {
		var data struct {
			Total   int `json:"total"`
			Members []struct {
				UserID string `json:"userID"`
			} `json:"members"`
		}
		if err := c.postWithAdmin(ctx, "/group/get_group_member_list", map[string]any{
			"groupID": groupID, "keyword": "",
			"pagination": map[string]int{"pageNumber": page, "showNumber": pageSize},
		}, &data); err != nil {
			return nil, err
		}
		for _, member := range data.Members {
			members = append(members, member.UserID)
		}
		if len(data.Members) == 0 || len(members) >= data.Total {
			return members, nil
		}
	}
}

// ListGroupMembers 分页拉取群成员列表，附带加入时间（毫秒），
// 供群聊已读状态计算时判断"消息发送后才入群"的成员。
func (c *Client) ListGroupMembers(ctx context.Context, groupID string) ([]GroupMemberLite, error) {
	const pageSize = 1000
	members := make([]GroupMemberLite, 0)
	for page := 1; ; page++ {
		var data struct {
			Total   int `json:"total"`
			Members []struct {
				UserID   string `json:"userID"`
				JoinTime int64  `json:"joinTime"`
			} `json:"members"`
		}
		if err := c.postWithAdmin(ctx, "/group/get_group_member_list", map[string]any{
			"groupID": groupID, "keyword": "",
			"pagination": map[string]int{"pageNumber": page, "showNumber": pageSize},
		}, &data); err != nil {
			return nil, err
		}
		for _, member := range data.Members {
			members = append(members, GroupMemberLite{UserID: member.UserID, JoinTime: member.JoinTime})
		}
		if len(data.Members) == 0 || len(members) >= data.Total {
			return members, nil
		}
	}
}

// GetConversationHasReadSeq 查询某用户在某条会话上的已读游标 hasReadSeq。
// 用户从未打开该会话（或无会话记录）时返回 0，即视为未读。
// 端点 GetConversationsHasReadAndMaxSeq 返回 { seqs: { conversationID: { hasReadSeq, maxSeq, maxSeqTime } } }。
func (c *Client) GetConversationHasReadSeq(ctx context.Context, userID, conversationID string) (int64, error) {
	var data struct {
		Seqs map[string]struct {
			HasReadSeq int64 `json:"hasReadSeq"`
		} `json:"seqs"`
	}
	if err := c.postWithAdmin(ctx, "/msg/get_conversations_has_read_and_max_seq", map[string]any{
		"userID":          userID,
		"conversationIDs": []string{conversationID},
	}, &data); err != nil {
		return 0, err
	}
	if seq, ok := data.Seqs[conversationID]; ok {
		return seq.HasReadSeq, nil
	}
	return 0, nil
}

func (c *Client) EnsureGroup(ctx context.Context, group Group) error {
	registered, err := c.IsGroupRegistered(ctx, group.GroupID)
	if err != nil {
		return err
	}
	if registered {
		// EnsureGroup is used by creation/reconciliation jobs. Updating an
		// existing group here would make OpenIM announce a fake profile change.
		return nil
	}
	applyMemberFriend := 1
	if group.AllowMemberAddFriend {
		applyMemberFriend = 0
	}
	err = c.postWithAdmin(ctx, "/group/create_group", map[string]any{
		"ownerUserID": group.OwnerUserID, "memberUserIDs": group.MemberUserIDs,
		"adminUserIDs": group.AdminUserIDs,
		"groupInfo": map[string]any{
			"groupID": group.GroupID, "groupName": group.GroupName,
			"notification": group.Notification, "faceURL": group.FaceURL,
			"groupType": 2, "needVerification": 0, "lookMemberInfo": 0,
			"applyMemberFriend": applyMemberFriend,
		},
	}, nil)
	return ignoreAlreadyDesired(err)
}

func (c *Client) UpdateGroup(ctx context.Context, groupID string, update GroupUpdate) error {
	request := map[string]any{"groupID": groupID}
	if update.GroupName != nil {
		request["groupName"] = *update.GroupName
	}
	if update.Notification != nil {
		request["notification"] = *update.Notification
	}
	if update.FaceURL != nil {
		request["faceURL"] = *update.FaceURL
	}
	if update.AllowMemberAddFriend != nil {
		applyMemberFriend := 1
		if *update.AllowMemberAddFriend {
			applyMemberFriend = 0
		}
		request["applyMemberFriend"] = applyMemberFriend
	}
	if len(request) == 1 {
		return nil
	}
	return c.postWithAdmin(ctx, "/group/set_group_info_ex", request, nil)
}

func (c *Client) InviteGroupMember(ctx context.Context, groupID string, userIDs []string) error {
	return c.InviteGroupMemberAs(ctx, "", groupID, userIDs)
}

func (c *Client) InviteGroupMemberAs(ctx context.Context, operatorUserID, groupID string, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	err := c.postAsUser(ctx, operatorUserID, "/group/invite_user_to_group", map[string]any{
		"groupID": groupID, "invitedUserIDs": userIDs, "reason": "business group sync",
	}, nil)
	return ignoreAlreadyDesired(err)
}

func (c *Client) KickGroupMember(ctx context.Context, groupID string, userIDs []string) error {
	return c.KickGroupMemberAs(ctx, "", groupID, userIDs)
}

func (c *Client) KickGroupMemberAs(ctx context.Context, operatorUserID, groupID string, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	err := c.postAsUser(ctx, operatorUserID, "/group/kick_group", map[string]any{
		"groupID": groupID, "kickedUserIDs": userIDs, "reason": "business group sync",
	}, nil)
	return ignoreNotFound(err)
}

func (c *Client) JoinGroup(ctx context.Context, userID, groupID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(groupID) == "" {
		return errors.New("invalid join group request")
	}
	token, err := c.mustUserToken(ctx, userID)
	if err != nil {
		return err
	}
	err = c.post(ctx, "/group/join_group", token, map[string]any{
		"groupID": groupID, "reqMessage": "", "joinSource": 4,
	}, nil)
	if err = ignoreAlreadyDesired(err); err == nil {
		return nil
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "verif") || strings.Contains(message, "apply") || strings.Contains(message, "审核") {
		return c.InviteGroupMember(ctx, groupID, []string{userID})
	}
	return err
}

func (c *Client) QuitGroup(ctx context.Context, userID, groupID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(groupID) == "" {
		return errors.New("invalid quit group request")
	}
	token, err := c.mustUserToken(ctx, userID)
	if err != nil {
		return err
	}
	err = c.post(ctx, "/group/quit_group", token, map[string]any{
		"groupID": groupID, "userID": userID,
	}, nil)
	return ignoreNotFound(err)
}

func (c *Client) SetGroupMemberRole(ctx context.Context, groupID, userID string, roleLevel int) error {
	return c.postWithAdmin(ctx, "/group/set_group_member_info", map[string]any{
		"members": []map[string]any{{
			"groupID": groupID, "userID": userID, "roleLevel": roleLevel,
		}},
	}, nil)
}

func (c *Client) SetGroupMemberNickname(ctx context.Context, groupID, userID, nickname string) error {
	return c.postWithAdmin(ctx, "/group/set_group_member_info", map[string]any{
		"members": []map[string]any{{
			"groupID": groupID, "userID": userID, "nickName": nickname,
		}},
	}, nil)
}

func (c *Client) SetGroupMemberMute(ctx context.Context, groupID, userID string, mutedSeconds int64) error {
	path := "/group/mute_group_member"
	request := map[string]any{"groupID": groupID, "userID": userID, "mutedSeconds": mutedSeconds}
	if mutedSeconds == 0 {
		path = "/group/cancel_mute_group_member"
		delete(request, "mutedSeconds")
	}
	return c.postWithAdmin(ctx, path, request, nil)
}

func (c *Client) SetGroupMute(ctx context.Context, groupID string, muted bool) error {
	path := "/group/cancel_mute_group"
	if muted {
		path = "/group/mute_group"
	}
	return c.postWithAdmin(ctx, path, map[string]any{"groupID": groupID}, nil)
}

func (c *Client) DismissGroup(ctx context.Context, groupID string) error {
	err := c.postWithAdmin(ctx, "/group/dismiss_group", map[string]any{
		"groupID": groupID, "deleteMember": false,
	}, nil)
	return ignoreNotFound(err)
}

func (c *Client) SendBusinessNotification(ctx context.Context, receiverUserID, receiverGroupID, key, data string, guaranteed bool) (SendMessageResult, error) {
	reliability := 1
	if guaranteed {
		reliability = 2
	}
	var result SendMessageResult
	err := c.postWithAdmin(ctx, "/msg/send_business_notification", map[string]any{
		"sendUserID": c.cfg.AdminUser, "recvUserID": receiverUserID,
		"recvGroupID": receiverGroupID, "key": key, "data": data,
		"sendMsg": true, "reliabilityLevel": reliability,
	}, &result)
	return result, err
}

func (c *Client) SendTextMessage(ctx context.Context, receiverID string, sessionType int, text string) (SendMessageResult, error) {
	var result SendMessageResult
	body := map[string]any{
		"sendID":         c.cfg.AdminUser,
		"content":        map[string]string{"content": text},
		"contentType":    101,
		"sessionType":    sessionType,
		"isOnlineOnly":   false,
		"notOfflinePush": false,
	}
	if sessionType == 3 {
		body["groupID"] = receiverID
	} else {
		body["recvID"] = receiverID
	}
	err := c.postWithAdmin(ctx, "/msg/send_msg", body, &result)
	return result, err
}

// RevokeMessage 撤回 OpenIM 消息（按 conversationID + seq）
func (c *Client) RevokeMessage(ctx context.Context, userID, conversationID string, seq int64) (bool, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(conversationID) == "" || seq <= 0 {
		return false, errors.New("invalid revoke message request")
	}
	// 必须用撤回者本人的 token 调用：OpenIM 3.8 的 revoke_msg 会用登录 token 对应的用户
	// 覆盖 body 里的 userID 作为撤回操作者。若用 admin token，撤回人会被记成 imAdmin，
	// 前端 /msg 撤回事件拿到的 revokerID 就成了 imAdmin。
	token := ""
	// 平台取 Web(3)；get_user_token 校验 1-11，仅用于换取认证 token，与客户端实际平台无关。
	if userToken, err := c.GetUserToken(ctx, userID, 3); err == nil {
		token = userToken.Token
	}
	// 兜底：取用户 token 失败时退回 admin token，保证撤回功能仍可用（撤回人显示会退回 imAdmin）。
	if token == "" {
		if t, err := c.GetAdminToken(ctx); err == nil {
			token = t
		}
	}
	err := c.post(ctx, "/msg/revoke_msg", token, map[string]any{
		"userID": userID, "conversationID": conversationID, "seq": seq,
	}, nil)
	if isAlreadyRecalled(err) {
		return true, nil
	}
	return false, err
}

// ConversationSettings 对应 OpenIM 的 Conversation 对象。
// 字段名与 OpenIM JSON 完全一致，可直接作为 set_conversations 的 conversation 体回写。
// recvMsgOpt 取值：0 正常接收 / 1 免打扰（不接收）/ 2 仅在线接收。
type ConversationSettings struct {
	ConversationID   string `json:"conversationID"`
	ConversationType int    `json:"conversationType"` // 1 单聊 2 群聊
	OwnerUserID      string `json:"ownerUserID"`      // 当前用户 OpenIM ID
	UserID           string `json:"userID"`           // 单聊对端 ID
	GroupID          string `json:"groupID"`          // 群聊 ID
	ShowName         string `json:"showName"`
	FaceURL          string `json:"faceURL"`
	RecvMsgOpt       int    `json:"recvMsgOpt"`
	UnreadCount      int    `json:"unreadCount"`
	GroupAtType      int    `json:"groupAtType"`   // 群 @ 强提醒档位
	IsPinned         bool   `json:"isPinned"`      // 置顶
	IsPrivateChat    bool   `json:"isPrivateChat"` // 阅后即焚开关
	IsNotInGroup     bool   `json:"isNotInGroup"`
	BurnDuration     int64  `json:"burnDuration"` // 阅后即焚时长（秒）
	HasReadSeq       int64  `json:"hasReadSeq"`
	MsgDestructTime  int64  `json:"msgDestructTime"` // 消息定时销毁时长（秒）
	IsMsgDestruct    bool   `json:"isMsgDestruct"`   // 是否开启消息定时销毁
	Ex               string `json:"ex"`              // 扩展字段（可存备注名）
	DraftText        string `json:"draftText"`       // 会话草稿
	AttachedInfo     string `json:"attachedInfo"`
}

type UpdateConversationSettings struct {
	RecvMsgOpt    *int  `json:"recvMsgOpt,omitempty"`
	IsPinned      *bool `json:"isPinned,omitempty"`
	IsPrivateChat *bool `json:"isPrivateChat,omitempty"`
	BurnDuration  *int  `json:"burnDuration,omitempty"`
}

// SendCustomC2CMessage 以 sendID 身份向单聊对端发 CustomMessage(110)。
// data 为业务 JSON 字符串（写入 customElem.data）；description 作会话预览文案。
func (c *Client) SendCustomC2CMessage(
	ctx context.Context,
	sendID, recvID, clientMsgID, data, description, extension string,
) (SendMessageResult, error) {
	if sendID == "" || recvID == "" || clientMsgID == "" || strings.TrimSpace(data) == "" {
		return SendMessageResult{}, errors.New("invalid custom c2c message")
	}
	if description == "" {
		description = "自定义消息"
	}
	var result SendMessageResult
	err := c.postWithAdmin(ctx, "/msg/send_msg", map[string]any{
		"sendID":      sendID,
		"recvID":      recvID,
		"clientMsgID": clientMsgID,
		"content": map[string]string{
			"data":        data,
			"description": description,
			"extension":   extension,
		},
		"contentType":    110,
		"sessionType":    1,
		"isOnlineOnly":   false,
		"notOfflinePush": false,
	}, &result)
	if result.ClientMsgID == "" {
		result.ClientMsgID = clientMsgID
	}
	return result, err
}

// SendForwardMessage 以原发送者身份向单聊目标发送已经冻结的消息内容。
// clientMsgID 由转发任务和目标用户确定性生成，Worker 重试时不会产生新的业务消息 ID。
// 万人转发暂不接离线推送，因此明确设置 notOfflinePush=true。
func (c *Client) SendForwardMessage(
	ctx context.Context,
	senderID, receiverID, clientMsgID string,
	contentType int,
	content json.RawMessage,
) (SendMessageResult, error) {
	if senderID == "" || receiverID == "" || clientMsgID == "" || contentType <= 0 || !json.Valid(content) {
		return SendMessageResult{}, errors.New("invalid forward message")
	}
	var decoded any
	if err := json.Unmarshal(content, &decoded); err != nil || decoded == nil {
		return SendMessageResult{}, errors.New("invalid forward message content")
	}
	var result SendMessageResult
	err := c.postWithAdmin(ctx, "/msg/send_msg", map[string]any{
		"sendID":         senderID,
		"recvID":         receiverID,
		"clientMsgID":    clientMsgID,
		"content":        decoded,
		"contentType":    contentType,
		"sessionType":    1,
		"isOnlineOnly":   false,
		"notOfflinePush": true,
	}, &result)
	if result.ClientMsgID == "" {
		result.ClientMsgID = clientMsgID
	}
	return result, err
}

func (c *Client) SendForwardGroupMessage(ctx context.Context, senderID, groupID, clientMsgID string,
	contentType int, content json.RawMessage) (SendMessageResult, error) {
	if senderID == "" || groupID == "" || clientMsgID == "" || contentType <= 0 || !json.Valid(content) {
		return SendMessageResult{}, errors.New("invalid forward group message")
	}
	var decoded any
	if err := json.Unmarshal(content, &decoded); err != nil || decoded == nil {
		return SendMessageResult{}, errors.New("invalid forward message content")
	}
	var result SendMessageResult
	err := c.postWithAdmin(ctx, "/msg/send_msg", map[string]any{
		"sendID": senderID, "groupID": groupID, "clientMsgID": clientMsgID,
		"content": decoded, "contentType": contentType, "sessionType": 3,
		"isOnlineOnly": false, "notOfflinePush": true,
	}, &result)
	if result.ClientMsgID == "" {
		result.ClientMsgID = clientMsgID
	}
	return result, err
}

// GetConversations 拉取指定会话的当前设置（全量对象）。
// v3.8.3 使用 ownerUserID；同时携带 opUserID/userID 兼容旧部署。
func (c *Client) GetConversations(ctx context.Context, opUserID string, conversationIDs []string) ([]ConversationSettings, error) {
	var data struct {
		ConversationInfos []ConversationSettings `json:"conversationInfos"`
		Conversations     []ConversationSettings `json:"conversations"`
	}
	err := c.postWithAdmin(ctx, "/conversation/get_conversations", map[string]any{
		"opUserID":        opUserID,
		"ownerUserID":     opUserID,
		"userID":          opUserID,
		"conversationIDs": conversationIDs,
	}, &data)
	if err != nil {
		return nil, err
	}
	if len(data.ConversationInfos) > 0 {
		return data.ConversationInfos, nil
	}
	return data.Conversations, nil
}

// GetConversationSettings 保留旧调用契约；新代码统一使用 GetConversations。
func (c *Client) GetConversationSettings(ctx context.Context, opUserID, conversationID string) (ConversationSettings, error) {
	items, err := c.GetConversations(ctx, opUserID, []string{conversationID})
	if err != nil {
		return ConversationSettings{}, err
	}
	if len(items) == 0 {
		return ConversationSettings{}, ErrConversationNotFound
	}
	return items[0], nil
}

// SetConversationSettings 保留旧调用契约，并将部分更新合并到全量会话对象。
func (c *Client) SetConversationSettings(ctx context.Context, opUserID string, current ConversationSettings, patch UpdateConversationSettings) error {
	if patch.RecvMsgOpt != nil {
		current.RecvMsgOpt = *patch.RecvMsgOpt
	}
	if patch.IsPinned != nil {
		current.IsPinned = *patch.IsPinned
	}
	if patch.IsPrivateChat != nil {
		current.IsPrivateChat = *patch.IsPrivateChat
	}
	if patch.BurnDuration != nil {
		current.BurnDuration = int64(*patch.BurnDuration)
	}
	return c.SetConversation(ctx, opUserID, current)
}

// SetConversation 写回单个会话的设置。调用方应先 GetConversations 取全量再叠加变更，
// 避免部分写入把未传字段按 protobuf 默认值清零。OpenIM v3.8.3 只公开复数路由 set_conversations。
func (c *Client) SetConversation(ctx context.Context, opUserID string, conv ConversationSettings) error {
	return c.postWithAdmin(ctx, "/conversation/set_conversations", map[string]any{
		"opUserID":     opUserID,
		"userID":       opUserID,
		"userIDs":      []string{opUserID},
		"conversation": conv,
	}, nil)
}

// CreateConversation 主动创建一个会话（OpenIM 原本是「首次发消息/拉取时自动建」）。
// 与前端 SDK 的 GetOneConversation 行为对齐：即使双方尚未发过消息，
// 后端设置会话（置顶/免打扰等）时也能先确保会话存在，避免 404。
//   - 单聊：conversationType=1，userID 为对端 OpenIM ID（opUserID 为创建者）。
//   - 群聊：conversationType=2，groupID 为群 OpenIM ID。
func (c *Client) CreateConversation(ctx context.Context, opUserID, conversationID string, conversationType int, userID, groupID string) error {
	return c.postWithAdmin(ctx, "/conversation/set_conversations", map[string]any{
		"opUserID": opUserID,
		"userID":   opUserID,
		"userIDs":  []string{opUserID},
		"conversation": map[string]any{
			"conversationID":   conversationID,
			"conversationType": conversationType,
			"ownerUserID":      opUserID,
			"userID":           userID,
			"groupID":          groupID,
			"recvMsgOpt":       0,
			"isPinned":         false,
		},
	}, nil)
}

// MarkConversationAsRead 清空指定会话未读数。
func (c *Client) MarkConversationAsRead(ctx context.Context, opUserID, conversationID string) error {
	return c.postWithAdmin(ctx, "/conversation/mark_conversation_as_read", map[string]any{
		"opUserID":       opUserID,
		"userID":         opUserID,
		"conversationID": conversationID,
	}, nil)
}

// ClearConversationMessages 删除指定用户在会话中的服务端漫游历史，并向该用户的
// 其他在线/离线设备发送清理同步通知。不会删除其他会话参与者的消息。
func (c *Client) ClearConversationMessages(ctx context.Context, userID string, conversationIDs []string) error {
	if userID == "" || len(conversationIDs) == 0 {
		return errors.New("userID and conversationIDs are required")
	}
	return c.postWithAdmin(ctx, "/msg/clear_conversation_msg", map[string]any{
		"userID":          userID,
		"conversationIDs": conversationIDs,
		"deleteSyncOpt": map[string]bool{
			"isSyncSelf":  true,
			"isSyncOther": false,
		},
	}, nil)
}

// SetGlobalMsgRecvOpt 设置用户级全局免打扰（对所有会话生效）。
// opt 取值同 recvMsgOpt：0 正常 / 1 免打扰 / 2 仅在线接收。
func (c *Client) SetGlobalMsgRecvOpt(ctx context.Context, opUserID string, opt int) error {
	return c.postWithAdmin(ctx, "/user/set_global_msg_recv_opt", map[string]any{
		"opUserID":   opUserID,
		"userID":     opUserID,
		"opt":        opt,
		"recvMsgOpt": opt,
	}, nil)
}

func (c *Client) postWithAdmin(ctx context.Context, path string, request, response any) error {
	token, err := c.GetAdminToken(ctx)
	if err != nil {
		return err
	}
	err = c.post(ctx, path, token, request, response)
	if err == nil || !isAuthError(err) {
		return err
	}
	c.adminMu.Lock()
	c.adminToken = ""
	c.adminExpiresAt = time.Time{}
	c.adminMu.Unlock()
	token, err = c.GetAdminToken(ctx)
	if err != nil {
		return err
	}
	return c.post(ctx, path, token, request, response)
}

func (c *Client) mustUserToken(ctx context.Context, userID string) (string, error) {
	userToken, err := c.GetUserToken(ctx, userID, 3)
	if err != nil {
		return "", fmt.Errorf("openim user token for %s: %w", userID, err)
	}
	if userToken.Token == "" {
		return "", fmt.Errorf("openim user token for %s is empty", userID)
	}
	return userToken.Token, nil
}

func (c *Client) postAsUser(ctx context.Context, userID, path string, request, response any) error {
	token := ""
	if strings.TrimSpace(userID) != "" {
		if userToken, err := c.GetUserToken(ctx, userID, 3); err == nil {
			token = userToken.Token
		}
	}
	if token == "" {
		var err error
		token, err = c.GetAdminToken(ctx)
		if err != nil {
			return err
		}
	}
	return c.post(ctx, path, token, request, response)
}

func (c *Client) post(ctx context.Context, path, token string, request, response any) error {
	if c == nil || c.client == nil {
		return ErrUnavailable
	}
	body, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode OpenIM request: %w", err)
	}
	url := strings.TrimRight(c.cfg.APIURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create OpenIM request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("operationID", uuid.NewString())
	if token != "" {
		req.Header.Set("token", token)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("call OpenIM: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("read OpenIM response: %w", err)
	}

	var envelope responseEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return &APIError{HTTPStatus: resp.StatusCode, ErrMsg: http.StatusText(resp.StatusCode)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || envelope.ErrCode != 0 {
		return &APIError{HTTPStatus: resp.StatusCode, ErrCode: envelope.ErrCode, ErrMsg: envelope.ErrMsg, ErrDlt: envelope.ErrDlt}
	}
	if response != nil && len(envelope.Data) > 0 && string(envelope.Data) != "null" {
		if err := json.Unmarshal(envelope.Data, response); err != nil {
			return fmt.Errorf("decode OpenIM response data: %w", err)
		}
	}
	return nil
}

func isAuthError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	if apiErr.HTTPStatus == http.StatusUnauthorized || apiErr.HTTPStatus == http.StatusForbidden {
		return true
	}
	message := strings.ToLower(apiErr.ErrMsg + " " + apiErr.ErrDlt)
	return strings.Contains(message, "token") && (strings.Contains(message, "expired") || strings.Contains(message, "invalid"))
}

func isNotFound(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.ErrCode == 1004
}

func ignoreNotFound(err error) error {
	if isNotFound(err) {
		return nil
	}
	return err
}

func ignoreAlreadyDesired(err error) error {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		message := strings.ToLower(apiErr.ErrMsg + " " + apiErr.ErrDlt)
		if apiErr.ErrCode == 1004 ||
			strings.Contains(message, "already") ||
			strings.Contains(message, "repeat") ||
			strings.Contains(message, "已在群") ||
			strings.Contains(message, "已经存在") {
			return nil
		}
	}
	return err
}

func isAlreadyRecalled(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	message := strings.ToLower(apiErr.ErrMsg + " " + apiErr.ErrDlt)
	already := strings.Contains(message, "already") || strings.Contains(message, "repeat") ||
		strings.Contains(message, "重复") || strings.Contains(message, "已经")
	recall := strings.Contains(message, "revoke") || strings.Contains(message, "withdraw") ||
		strings.Contains(message, "撤回")
	return already && recall
}
