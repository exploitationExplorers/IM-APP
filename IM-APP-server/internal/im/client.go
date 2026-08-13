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
)

const maxResponseBytes = 2 << 20

var (
	ErrUnavailable     = errors.New("openim is not configured")
	ErrInvalidPlatform = errors.New("invalid OpenIM platform ID")
	ErrInvalidUserID   = errors.New("invalid business user ID")
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
	return false, errors.New("openim account check response did not contain requested user")
}

// EnsureUser makes PostgreSQL's user visible to OpenIM and keeps the OpenIM
// nickname/avatar current. account_check makes retries idempotent.
func (c *Client) EnsureUser(ctx context.Context, user User) error {
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

func (c *Client) EnsureGroup(ctx context.Context, group Group) error {
	registered, err := c.IsGroupRegistered(ctx, group.GroupID)
	if err != nil {
		return err
	}
	if registered {
		return c.UpdateGroup(ctx, group)
	}
	applyMemberFriend := 1
	if group.AllowMemberAddFriend {
		applyMemberFriend = 0
	}
	return c.postWithAdmin(ctx, "/group/create_group", map[string]any{
		"ownerUserID": group.OwnerUserID, "memberUserIDs": group.MemberUserIDs,
		"adminUserIDs": group.AdminUserIDs,
		"groupInfo": map[string]any{
			"groupID": group.GroupID, "groupName": group.GroupName,
			"notification": group.Notification, "faceURL": group.FaceURL,
			"groupType": 2, "needVerification": 0, "lookMemberInfo": 0,
			"applyMemberFriend": applyMemberFriend,
		},
	}, nil)
}

func (c *Client) UpdateGroup(ctx context.Context, group Group) error {
	applyMemberFriend := 1
	if group.AllowMemberAddFriend {
		applyMemberFriend = 0
	}
	return c.postWithAdmin(ctx, "/group/set_group_info_ex", map[string]any{
		"groupID": group.GroupID, "groupName": group.GroupName,
		"notification": group.Notification, "faceURL": group.FaceURL,
		"applyMemberFriend": applyMemberFriend,
	}, nil)
}

func (c *Client) InviteGroupMember(ctx context.Context, groupID string, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	err := c.postWithAdmin(ctx, "/group/invite_user_to_group", map[string]any{
		"groupID": groupID, "invitedUserIDs": userIDs, "reason": "business group sync",
	}, nil)
	return ignoreAlreadyDesired(err)
}

func (c *Client) KickGroupMember(ctx context.Context, groupID string, userIDs []string) error {
	if len(userIDs) == 0 {
		return nil
	}
	err := c.postWithAdmin(ctx, "/group/kick_group", map[string]any{
		"groupID": groupID, "kickedUserIDs": userIDs, "reason": "business group sync",
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
	err := c.postWithAdmin(ctx, "/msg/send_msg", map[string]any{
		"sendID": c.cfg.AdminUser, "recvID": receiverID,
		"content": map[string]string{"content": text}, "contentType": 101,
		"sessionType": sessionType, "isOnlineOnly": false, "notOfflinePush": false,
	}, &result)
	return result, err
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
		if apiErr.ErrCode == 1004 || strings.Contains(message, "already") || strings.Contains(message, "repeat") {
			return nil
		}
	}
	return err
}
