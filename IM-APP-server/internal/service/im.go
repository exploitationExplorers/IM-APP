package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"im-app-server/internal/config"
	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrIMUnavailable          = errors.New("OpenIM service is unavailable")
	ErrIMAccountInactive      = errors.New("account is not active")
	ErrIMConversationNotFound = errors.New("conversation not found")
	ErrIMInvalidRecvMsgOpt    = errors.New("invalid recvMsgOpt, must be 0/1/2")
	// ErrIMTargetNotChattable 表示当前用户与该好友/群不能聊天（非好友/被拉黑/群禁言等）。
	ErrIMTargetNotChattable = errors.New("cannot chat with this peer")
	// ErrIMInvalidPeerType 表示 peerType 不是 c2c 或 group。
	ErrIMInvalidPeerType = errors.New("peerType must be c2c or group")
)

type IMToken struct {
	UserID    string `json:"userId"`
	Token     string `json:"token"`
	Platform  int    `json:"platform"`
	ExpireSec int    `json:"expireSec"`
	APIAddr   string `json:"apiAddr"`
	WSAddr    string `json:"wsAddr"`
}

const (
	imTokenCachePrefix  = "openim:user-token:v1:"
	imTokenRefreshAhead = 5 * time.Minute
)

// IMTokenCache is intentionally small so the IM service can use Redis without
// coupling its business logic to a concrete Redis client.
type IMTokenCache interface {
	Available() bool
	CacheGet(ctx context.Context, key string) (value string, found bool, err error)
	CacheSet(ctx context.Context, key, value string, ttl time.Duration) error
}

type cachedIMToken struct {
	Token     IMToken `json:"token"`
	ExpiresAt int64   `json:"expiresAt"`
	RefreshAt int64   `json:"refreshAt"`
}

type imTokenKeyLock struct {
	mu   sync.Mutex
	refs int
}

type IMService struct {
	Client     *im.Client
	Users      *repository.UserRepo
	Groups     *repository.GroupRepo
	Access     *repository.IMAccessRepo
	Config     config.OpenIMConfig
	TokenCache IMTokenCache

	tokenLocksMu sync.Mutex
	tokenLocks   map[string]*imTokenKeyLock
	localTokenMu sync.RWMutex
	localTokens  map[string]cachedIMToken
}

func (s *IMService) ResolvePeer(ctx context.Context, requesterID, targetID string) (models.IMPeer, error) {
	imUserID, err := im.UserIDFromBusinessID(targetID)
	if err != nil {
		return models.IMPeer{}, err
	}
	peer, err := s.Access.ResolvePeer(ctx, requesterID, targetID)
	if err != nil {
		return peer, err
	}
	peer.IMUserID = imUserID
	return peer, nil
}

func (s *IMService) ResolveGroup(ctx context.Context, userID, groupID string) (models.IMGroupTarget, error) {
	internalID, err := s.Groups.InternalIDByPublicID(ctx, groupID)
	if err != nil {
		return models.IMGroupTarget{}, repository.ErrIMTargetNotFound
	}
	imGroupID, err := im.UserIDFromBusinessID(internalID)
	if err != nil {
		return models.IMGroupTarget{}, err
	}
	group, err := s.Access.ResolveGroup(ctx, userID, internalID)
	if err != nil {
		return group, err
	}
	group.BusinessGroupID = groupID
	group.IMGroupID = imGroupID
	return group, nil
}

func (s *IMService) Token(ctx context.Context, userID string, platformID int) (IMToken, error) {
	if s.Client == nil || !s.Client.Available() || s.Config.PublicAPIURL == "" || s.Config.PublicWSURL == "" {
		return IMToken{}, ErrIMUnavailable
	}
	user, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return IMToken{}, ErrIMAccountInactive
		}
		return IMToken{}, err
	}
	if user.Status != "active" {
		return IMToken{}, ErrIMAccountInactive
	}
	openIMUserID, err := im.UserIDFromBusinessID(user.ID)
	if err != nil {
		return IMToken{}, err
	}

	cacheKey := fmt.Sprintf("%s%s:%s:%d", imTokenCachePrefix, s.tokenCacheNamespace(), openIMUserID, platformID)
	return s.getOrIssueToken(ctx, cacheKey, func() (IMToken, error) {
		if err := s.Client.EnsureUser(ctx, im.User{
			UserID: openIMUserID, Nickname: user.Nickname, FaceURL: user.Avatar,
		}); err != nil {
			return IMToken{}, err
		}
		token, err := s.Client.GetUserToken(ctx, openIMUserID, platformID)
		if err != nil {
			return IMToken{}, err
		}
		return IMToken{
			UserID: openIMUserID, Token: token.Token, Platform: token.PlatformID,
			ExpireSec: token.ExpireSec, APIAddr: s.Config.PublicAPIURL, WSAddr: s.Config.PublicWSURL,
		}, nil
	})
}

func (s *IMService) tokenCacheNamespace() string {
	// Changing OpenIM deployments or credentials must never reuse a token issued
	// by the previous OpenIM environment. The secret itself is not exposed.
	sum := sha256.Sum256([]byte(s.Config.APIURL + "\x00" + s.Config.Secret + "\x00" + s.Config.AdminUser))
	return fmt.Sprintf("%x", sum[:8])
}

// getOrIssueToken makes token issuance idempotent for a user and platform.
// OpenIM can invalidate an earlier token when get_user_token is called again;
// therefore concurrent and repeated API requests must share the cached token.
func (s *IMService) getOrIssueToken(
	ctx context.Context,
	cacheKey string,
	issue func() (IMToken, error),
) (IMToken, error) {
	// Only calls for the same user and platform are serialized. Different users
	// can obtain tokens concurrently without racing through the same cache miss.
	unlock := s.lockTokenKey(cacheKey)
	defer unlock()

	now := time.Now()
	redisAvailable := s.TokenCache != nil && s.TokenCache.Available()
	useLocalCache := !redisAvailable
	if redisAvailable {
		payload, found, err := s.TokenCache.CacheGet(ctx, cacheKey)
		if err != nil {
			log.Printf("openim token cache read failed: %v", err)
		} else if found {
			var cached cachedIMToken
			if err := json.Unmarshal([]byte(payload), &cached); err != nil {
				log.Printf("openim token cache decode failed: %v", err)
			} else if token, ok := s.cachedToken(cached, now); ok {
				s.rememberToken(cacheKey, cached)
				return token, nil
			}
		}
		// A Redis miss, corrupt value, or transient read error still permits
		// the valid process-local copy to prevent duplicate token issuance.
		useLocalCache = true
	}

	// Redis failures must not turn the token endpoint into a 5xx response.
	// The local cache still prevents duplicate token creation in this process.
	if useLocalCache {
		if token, ok := s.cachedToken(s.localToken(cacheKey), now); ok {
			return token, nil
		}
	}

	token, err := issue()
	if err != nil {
		return IMToken{}, err
	}
	cached, ttl, ok := newCachedIMToken(token, now)
	if !ok {
		return token, nil
	}
	s.rememberToken(cacheKey, cached)

	if redisAvailable {
		payload, err := json.Marshal(cached)
		if err != nil {
			log.Printf("openim token cache encode failed: %v", err)
			return token, nil
		}
		// Complete the cache write even if the HTTP caller disconnects after
		// OpenIM has already issued the token.
		cacheCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		err = s.TokenCache.CacheSet(cacheCtx, cacheKey, string(payload), ttl)
		cancel()
		if err != nil {
			log.Printf("openim token cache write failed: %v", err)
		}
	}
	return token, nil
}

func (s *IMService) rememberToken(key string, token cachedIMToken) {
	s.localTokenMu.Lock()
	defer s.localTokenMu.Unlock()
	if s.localTokens == nil {
		s.localTokens = make(map[string]cachedIMToken)
	}
	s.localTokens[key] = token
}

func (s *IMService) localToken(key string) cachedIMToken {
	s.localTokenMu.RLock()
	defer s.localTokenMu.RUnlock()
	return s.localTokens[key]
}

func (s *IMService) lockTokenKey(key string) func() {
	s.tokenLocksMu.Lock()
	if s.tokenLocks == nil {
		s.tokenLocks = make(map[string]*imTokenKeyLock)
	}
	keyLock := s.tokenLocks[key]
	if keyLock == nil {
		keyLock = &imTokenKeyLock{}
		s.tokenLocks[key] = keyLock
	}
	keyLock.refs++
	s.tokenLocksMu.Unlock()

	keyLock.mu.Lock()
	return func() {
		keyLock.mu.Unlock()
		s.tokenLocksMu.Lock()
		keyLock.refs--
		if keyLock.refs == 0 {
			delete(s.tokenLocks, key)
		}
		s.tokenLocksMu.Unlock()
	}
}

func (s *IMService) cachedToken(cached cachedIMToken, now time.Time) (IMToken, bool) {
	nowUnix := now.Unix()
	if cached.Token.Token == "" || nowUnix >= cached.RefreshAt || nowUnix >= cached.ExpiresAt {
		return IMToken{}, false
	}
	remaining := int(cached.ExpiresAt - nowUnix)
	if remaining <= 0 {
		return IMToken{}, false
	}
	token := cached.Token
	token.ExpireSec = remaining
	// Connection addresses are deployment configuration, not token state.
	// Always return the current values even for an older cached token.
	token.APIAddr = s.Config.PublicAPIURL
	token.WSAddr = s.Config.PublicWSURL
	return token, true
}

func newCachedIMToken(token IMToken, now time.Time) (cachedIMToken, time.Duration, bool) {
	if token.Token == "" || token.ExpireSec <= 1 {
		return cachedIMToken{}, 0, false
	}
	lifetime := time.Duration(token.ExpireSec) * time.Second
	refreshAhead := imTokenRefreshAhead
	if lifetime <= refreshAhead {
		refreshAhead = lifetime / 10
	}
	ttl := lifetime - refreshAhead
	if ttl < time.Second {
		return cachedIMToken{}, 0, false
	}
	return cachedIMToken{
		Token:     token,
		ExpiresAt: now.Add(lifetime).Unix(),
		RefreshAt: now.Add(ttl).Unix(),
	}, ttl, true
}

// ConversationPatch 是 UpdateConversationSettings 的入参。
// 用指针字段区分「客户端没传」与「传了零值」，从而支持部分更新。
type ConversationPatch struct {
	RecvMsgOpt      *int
	IsPinned        *bool
	IsPrivateChat   *bool
	BurnDuration    *int64
	IsMsgDestruct   *bool
	MsgDestructTime *int64
	GroupAtType     *int
	Ex              *string
	DraftText       *string
}

// validateRecvMsgOpt 校验消息接收选项取值：0 正常 / 1 免打扰 / 2 仅在线接收。
func validateRecvMsgOpt(opt int) bool {
	return opt == 0 || opt == 1 || opt == 2
}

// resolveConversationID 把「业务好友/群 ID + 类型」解析为 OpenIM conversationID。
// 单聊：si_ + 两个 OpenIM 用户ID排序后用 _ 连接（OpenIM 规则，无歧义）。
// 群聊：本项目 EnsureGroup 用 groupType=2（超级群）→ 前缀 sg_；兼容普通群前缀 g_
//       做兜底（按候选顺序命中已存在的会话）。返回 conversationID 与当前用户 opUserID。
func (s *IMService) resolveConversationID(ctx context.Context, userID, peerType, peerId string) (string, string, error) {
	opUserID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return "", "", err
	}
	switch peerType {
	case "c2c":
		peer, perr := s.ResolvePeer(ctx, userID, peerId)
		if perr != nil {
			return "", "", perr
		}
		if !peer.CanChat {
			return "", "", ErrIMTargetNotChattable
		}
		return buildC2CConversationID(opUserID, peer.IMUserID), opUserID, nil
	case "group":
		grp, gerr := s.ResolveGroup(ctx, userID, peerId)
		if gerr != nil {
			return "", "", gerr
		}
		if !grp.CanChat {
			return "", "", ErrIMTargetNotChattable
		}
		cid, rerr := s.resolveGroupConversationID(ctx, opUserID, grp.IMGroupID)
		if rerr != nil {
			return "", "", rerr
		}
		return cid, opUserID, nil
	default:
		return "", "", ErrIMInvalidPeerType
	}
}

// buildC2CConversationID 单聊会话 ID：si_ + 两个用户ID字典序排序后下划线连接。
func buildC2CConversationID(a, b string) string {
	ids := []string{a, b}
	sort.Strings(ids)
	return "si_" + strings.Join(ids, "_")
}

// resolveGroupConversationID 群会话 ID 按候选前缀依次尝试：命中已存在会话即用它；
// 都不存在时默认超级群前缀 sg_（本项目群均为 groupType=2 超级群）。
func (s *IMService) resolveGroupConversationID(ctx context.Context, opUserID, groupID string) (string, error) {
	candidates := []string{"sg_" + groupID, "g_" + groupID}
	for _, cid := range candidates {
		list, err := s.Client.GetConversations(ctx, opUserID, []string{cid})
		if err == nil && len(list) > 0 {
			return cid, nil
		}
	}
	return candidates[0], nil
}

// GetConversationSettings 返回指定会话的当前设置（OpenIM 全量对象）。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
func (s *IMService) GetConversationSettings(ctx context.Context, userID, peerType, peerId string) (*im.ConversationSettings, error) {
	if s.Client == nil || !s.Client.Available() {
		return nil, ErrIMUnavailable
	}
	convID, opUserID, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return nil, err
	}
	list, err := s.Client.GetConversations(ctx, opUserID, []string{convID})
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, ErrIMConversationNotFound
	}
	return &list[0], nil
}

// UpdateConversationSettings 部分更新会话设置。
// 关键：先 GET 全量会话对象，再叠加本次传入的字段，最后 SET 回写，
// 避免 protobuf 部分写入把未传字段按默认值清零（破坏其它设置）。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
func (s *IMService) UpdateConversationSettings(ctx context.Context, userID, peerType, peerId string, patch ConversationPatch) (*im.ConversationSettings, error) {
	if s.Client == nil || !s.Client.Available() {
		return nil, ErrIMUnavailable
	}
	convID, opUserID, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return nil, err
	}

	// 1) 取全量，作为回写基准
	current, err := s.Client.GetConversations(ctx, opUserID, []string{convID})
	if err != nil {
		return nil, err
	}
	if len(current) == 0 {
		return nil, ErrIMConversationNotFound
	}
	conv := current[0]

	// 2) 叠加本次传入的字段
	if patch.RecvMsgOpt != nil {
		if !validateRecvMsgOpt(*patch.RecvMsgOpt) {
			return nil, ErrIMInvalidRecvMsgOpt
		}
		conv.RecvMsgOpt = *patch.RecvMsgOpt
	}
	if patch.IsPinned != nil {
		conv.IsPinned = *patch.IsPinned
	}
	if patch.IsPrivateChat != nil {
		conv.IsPrivateChat = *patch.IsPrivateChat
	}
	if patch.BurnDuration != nil {
		conv.BurnDuration = *patch.BurnDuration
	}
	if patch.IsMsgDestruct != nil {
		conv.IsMsgDestruct = *patch.IsMsgDestruct
	}
	if patch.MsgDestructTime != nil {
		conv.MsgDestructTime = *patch.MsgDestructTime
	}
	if patch.GroupAtType != nil {
		conv.GroupAtType = *patch.GroupAtType
	}
	if patch.Ex != nil {
		conv.Ex = *patch.Ex
	}
	if patch.DraftText != nil {
		conv.DraftText = *patch.DraftText
	}

	// 3) 回写合并后的全量对象
	if err := s.Client.SetConversation(ctx, opUserID, conv); err != nil {
		return nil, err
	}

	// 4) 再 GET 一次拿到服务端最新值返回（OpenIM 回写可能异步最终一致）
	updated, err := s.Client.GetConversations(ctx, opUserID, []string{convID})
	if err != nil || len(updated) == 0 {
		return &conv, nil
	}
	return &updated[0], nil
}

// MarkConversationRead 清空指定会话未读数。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
func (s *IMService) MarkConversationRead(ctx context.Context, userID, peerType, peerId string) error {
	if s.Client == nil || !s.Client.Available() {
		return ErrIMUnavailable
	}
	convID, opUserID, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return err
	}
	return s.Client.MarkConversationAsRead(ctx, opUserID, convID)
}

// SetGlobalMsgRecvOpt 设置用户级全局免打扰（对所有会话生效）。
func (s *IMService) SetGlobalMsgRecvOpt(ctx context.Context, userID string, opt int) error {
	if s.Client == nil || !s.Client.Available() {
		return ErrIMUnavailable
	}
	if !validateRecvMsgOpt(opt) {
		return ErrIMInvalidRecvMsgOpt
	}
	opUserID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return err
	}
	return s.Client.SetGlobalMsgRecvOpt(ctx, opUserID, opt)
}
