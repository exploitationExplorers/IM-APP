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

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"im-app-server/internal/config"
	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrIMUnavailable               = errors.New("OpenIM service is unavailable")
	ErrIMAccountInactive           = errors.New("account is not active")
	ErrIMConversationNotFound      = errors.New("conversation not found")
	ErrIMInvalidRecvMsgOpt         = errors.New("invalid recvMsgOpt, must be 0/1/2")
	ErrInvalidConversationSettings = errors.New("invalid conversation settings")
	// ErrIMTargetNotChattable 表示当前用户与该好友/群不能聊天（非好友/被拉黑/群禁言等）。
	ErrIMTargetNotChattable = errors.New("cannot chat with this peer")
	// ErrIMInvalidPeerType 表示 peerType 不是 c2c 或 group。
	ErrIMInvalidPeerType      = errors.New("peerType must be c2c or group")
	ErrIMInvalidRecallRequest = errors.New("invalid message recall request")
	ErrIMRecallForbidden      = errors.New("message recall is forbidden")
	ErrIMRecallExpired        = errors.New("message recall window expired")
	ErrIMUnsupportedMessage   = errors.New("message type cannot be recalled")
	ErrIMRecallConflict       = errors.New("message recall is in progress")
	ErrIMMessageNotFound      = errors.New("message not found")
	ErrIMRecallUpstream       = errors.New("OpenIM message recall failed")
	// ErrIMInvalidReadStatusRequest 表示已读状态查询参数不合法。
	ErrIMInvalidReadStatusRequest = errors.New("invalid message read status request")
	// ErrIMNotGroupMember 表示调用者不是该群成员，无权查询已读状态。
	ErrIMNotGroupMember = errors.New("caller is not a group member")
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

	imGroupReadCursorPrefix = "im:group:read:v1:"
)

// IMTokenCache is intentionally small so the IM service can use Redis without
// coupling its business logic to a concrete Redis client.
type IMTokenCache interface {
	Available() bool
	CacheGet(ctx context.Context, key string) (value string, found bool, err error)
	CacheSet(ctx context.Context, key, value string, ttl time.Duration) error
}

type IMGroupReadCursorCache interface {
	GroupReadCursorUpsert(ctx context.Context, key, userID string, seq int64) error
	GroupReadCursorMaxOther(ctx context.Context, key, userID string) (seq int64, found bool, err error)
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
	Client      *im.Client
	Users       *repository.UserRepo
	Groups      *repository.GroupRepo
	Access      *repository.IMAccessRepo
	ReadCursors *repository.GroupReadCursorRepo
	Config      config.OpenIMConfig
	TokenCache  IMTokenCache

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
	internalID, publicID, err := s.Groups.LookupGroupIDs(ctx, groupID)
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
	group.BusinessGroupID = publicID
	group.IMGroupID = imGroupID
	if err := s.ensureOpenIMGroup(ctx, userID, internalID, imGroupID); err != nil {
		return models.IMGroupTarget{}, err
	}
	return group, nil
}

// ResolveGroupByIM 是 ResolveGroup 的逆入口：前端只有 OpenIM 群 ID（来自会话列表）
// 时，先把它还原成内部 UUID，再换出对外 public ID 与 OpenIM 群 ID。
func (s *IMService) ResolveGroupByIM(ctx context.Context, userID, imGroupID string) (models.IMGroupTarget, error) {
	internalID, err := im.BusinessIDFromUserID(imGroupID)
	if err != nil {
		return models.IMGroupTarget{}, repository.ErrIMTargetNotFound
	}
	publicID, err := s.Groups.PublicIDByInternalID(ctx, internalID)
	if err != nil {
		return models.IMGroupTarget{}, err
	}
	return s.ResolveGroup(ctx, userID, publicID)
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

// conversationTarget 是「业务好友/群 ID + 类型」解析后的会话目标，
// 同时携带创建会话所需的元信息（类型与对端/群 IM ID），供会话不存在时自动创建。
type conversationTarget struct {
	ConversationID   string // OpenIM conversationID（si_xxx / sg_xxx）
	OpUserID         string // 当前用户 OpenIM ID
	ConversationType int    // 1 单聊 2 群聊
	PeerIMID         string // 单聊对端 OpenIM ID（群聊为空）
	GroupIMID        string // 群聊 OpenIM ID（单聊为空）
}

// resolveConversationID 把「业务好友/群 ID + 类型」解析为会话目标。
// 单聊：si_ + 两个 OpenIM 用户ID排序后用 _ 连接（OpenIM 规则，无歧义）。
// 群聊：本项目 EnsureGroup 用 groupType=2（超级群）→ 前缀 sg_；兼容普通群前缀 g_
//
//	做兜底（按候选顺序命中已存在的会话）。
func (s *IMService) resolveConversationID(ctx context.Context, userID, peerType, peerId string) (conversationTarget, error) {
	opUserID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return conversationTarget{}, err
	}
	switch peerType {
	case "c2c":
		peer, perr := s.ResolvePeer(ctx, userID, peerId)
		if perr != nil {
			return conversationTarget{}, perr
		}
		if !peer.CanChat {
			return conversationTarget{}, ErrIMTargetNotChattable
		}
		return conversationTarget{
			ConversationID:   buildC2CConversationID(opUserID, peer.IMUserID),
			OpUserID:         opUserID,
			ConversationType: 1,
			PeerIMID:         peer.IMUserID,
		}, nil
	case "group":
		grp, gerr := s.ResolveGroup(ctx, userID, peerId)
		if gerr != nil {
			return conversationTarget{}, gerr
		}
		if !grp.CanChat {
			return conversationTarget{}, ErrIMTargetNotChattable
		}
		cid, rerr := s.resolveGroupConversationID(ctx, opUserID, grp.IMGroupID)
		if rerr != nil {
			return conversationTarget{}, rerr
		}
		return conversationTarget{
			ConversationID:   cid,
			OpUserID:         opUserID,
			ConversationType: 2,
			GroupIMID:        grp.IMGroupID,
		}, nil
	default:
		return conversationTarget{}, ErrIMInvalidPeerType
	}
}

// buildC2CConversationID 单聊会话 ID：si_ + 两个用户ID字典序排序后下划线连接。
func buildC2CConversationID(a, b string) string {
	ids := []string{a, b}
	sort.Strings(ids)
	return "si_" + strings.Join(ids, "_")
}

// peerUserIDFromConversation 兼容 OpenIM 单聊会话 ID，并且不按下划线切分用户 ID。
func peerUserIDFromConversation(conversationID, ownerUserID string) (string, error) {
	if !strings.HasPrefix(conversationID, "si_") || ownerUserID == "" {
		return "", ErrInvalidConversationSettings
	}
	payload := strings.TrimPrefix(conversationID, "si_")
	if strings.HasPrefix(payload, ownerUserID+"_") {
		peer := strings.TrimPrefix(payload, ownerUserID+"_")
		if peer != "" {
			return peer, nil
		}
	}
	if strings.HasSuffix(payload, "_"+ownerUserID) {
		peer := strings.TrimSuffix(payload, "_"+ownerUserID)
		if peer != "" {
			return peer, nil
		}
	}
	return "", ErrInvalidConversationSettings
}

// resolveGroupConversationID 群会话 ID 按候选前缀依次尝试：命中已存在会话即用它；
// 都不存在时默认超级群前缀 sg_（本项目群均为 groupType=2 超级群）。
// 若两个候选的查询都出错（而非「不存在」），返回最近一次错误，交由上层处理，
// 不再静默兜底，避免把未知故障伪装成「用 sg_ 前缀」去创建/设置。
func (s *IMService) resolveGroupConversationID(ctx context.Context, opUserID, groupID string) (string, error) {
	candidates := []string{"sg_" + groupID, "g_" + groupID}
	var lastErr error
	for _, cid := range candidates {
		list, err := s.Client.GetConversations(ctx, opUserID, []string{cid})
		if err != nil {
			lastErr = err
			continue
		}
		if len(list) > 0 {
			return cid, nil
		}
	}
	if lastErr != nil {
		return "", lastErr
	}
	return candidates[0], nil
}

// GetConversationSettings 返回指定会话的当前设置（OpenIM 全量对象）。
// peerType ∈ {c2c, group}，peerId 为业务好友 ID 或业务群 ID（由后端拼 conversationId）。
// 会话在 OpenIM 中尚不存在时（双方从未发过消息），与前端 SDK GetOneConversation 对齐，
// 主动创建会话后再返回，避免直接 404。
func (s *IMService) GetConversationSettings(ctx context.Context, userID, peerType, peerId string) (*im.ConversationSettings, error) {
	if s.Client == nil || !s.Client.Available() {
		return nil, ErrIMUnavailable
	}
	target, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return nil, err
	}
	// 同一会话的读与写串行化，避免与 UpdateConversationSettings 的读改写竞态。
	unlock := s.lockTokenKey("conv:" + target.ConversationID)
	defer unlock()
	list, err := s.Client.GetConversations(ctx, target.OpUserID, []string{target.ConversationID})
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		if cerr := s.Client.CreateConversation(ctx, target.OpUserID, target.ConversationID,
			target.ConversationType, target.PeerIMID, target.GroupIMID); cerr != nil {
			return nil, cerr
		}
		list, err = s.Client.GetConversations(ctx, target.OpUserID, []string{target.ConversationID})
		if err != nil {
			return nil, err
		}
		if len(list) == 0 {
			return nil, ErrIMConversationNotFound
		}
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
	target, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return nil, err
	}

	// 同一会话串行化「先读全量 → 叠加变更 → 回写」，避免并发设置互相覆盖。
	unlock := s.lockTokenKey("conv:" + target.ConversationID)
	defer unlock()

	// 1) 取全量，作为回写基准（会话尚不存在时先创建，对齐前端 GetOneConversation）
	current, err := s.Client.GetConversations(ctx, target.OpUserID, []string{target.ConversationID})
	if err != nil {
		return nil, err
	}
	if len(current) == 0 {
		if cerr := s.Client.CreateConversation(ctx, target.OpUserID, target.ConversationID,
			target.ConversationType, target.PeerIMID, target.GroupIMID); cerr != nil {
			return nil, cerr
		}
		current, err = s.Client.GetConversations(ctx, target.OpUserID, []string{target.ConversationID})
		if err != nil {
			return nil, err
		}
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
	if err := s.Client.SetConversation(ctx, target.OpUserID, conv); err != nil {
		return nil, err
	}

	// 4) 再 GET 一次拿到服务端最新值返回（OpenIM 回写可能异步最终一致）
	updated, err := s.Client.GetConversations(ctx, target.OpUserID, []string{target.ConversationID})
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
	target, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return err
	}
	return s.Client.MarkConversationAsRead(ctx, target.OpUserID, target.ConversationID)
}

// ClearConversationMessages 清除当前用户在指定会话中的服务端漫游历史，并同步到
// 当前用户的其他设备。isSyncOther=false 保证不影响私聊对方或其他群成员。
func (s *IMService) ClearConversationMessages(ctx context.Context, userID, peerType, peerId string) error {
	if s.Client == nil || !s.Client.Available() {
		return ErrIMUnavailable
	}
	target, err := s.resolveConversationID(ctx, userID, peerType, peerId)
	if err != nil {
		return err
	}
	return s.Client.ClearConversationMessages(ctx, target.OpUserID, []string{target.ConversationID})
}

// ReportSendFailure 落库一条客户端上报的发送失败记录。
// sender 身份取自 JWT 的 userID（业务 UUID），忽略请求体伪造；
// target 兼容业务 UUID 与 OpenIM id 两种写法；按 client_msg_id+stage 幂等。
func (s *IMService) ReportSendFailure(ctx context.Context, userID string, req models.ReportSendFailureRequest) error {
	peerType := strings.TrimSpace(req.PeerType)
	if peerType != "c2c" && peerType != "group" {
		peerType = "c2c"
	}

	// sender：JWT userID 为业务 UUID，解析出 OpenIM id；解析失败则不落 sender_id（保持 best-effort）。
	senderID := userID
	senderIMID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		senderID, senderIMID = "", ""
	}

	// target：可能是业务 UUID（转 OpenIM id）或 OpenIM id（反解业务 UUID）。
	var targetID, targetIMID string
	if raw := strings.TrimSpace(req.TargetID); raw != "" {
		if imID, err := im.UserIDFromBusinessID(raw); err == nil {
			targetID, targetIMID = raw, imID
		} else if bizID, err := im.BusinessIDFromUserID(raw); err == nil {
			targetID, targetIMID = bizID, strings.ToLower(raw)
		} else {
			targetIMID = raw
		}
	}

	// occurredAt：RFC3339 可空，解析失败交由 DB 用 NOW()。
	var occurredAt *time.Time
	if raw := strings.TrimSpace(req.OccurredAt); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			occurredAt = &t
		}
	}

	return s.Access.RecordSendFailure(ctx, repository.SendFailureRecord{
		ClientMsgID:    strings.TrimSpace(req.ClientMsgID),
		Source:         "client",
		SenderID:       senderID,
		SenderIMID:     senderIMID,
		PeerType:       peerType,
		TargetID:       targetID,
		TargetIMID:     targetIMID,
		ContentType:    req.ContentType,
		Stage:          strings.TrimSpace(req.Stage),
		FailCode:       strings.TrimSpace(req.FailCode),
		FailMessage:    strings.TrimSpace(req.FailMessage),
		ClientPlatform: strings.TrimSpace(req.Platform),
		AppVersion:     strings.TrimSpace(req.AppVersion),
		OccurredAt:     occurredAt,
	})
}

func (s *IMService) RecallMessage(ctx context.Context, userID string, req models.RecallMessageRequest) (models.MessageRecallResult, error) {
	result := models.MessageRecallResult{
		PeerType: req.PeerType, PeerID: req.PeerID, ClientMsgID: req.ClientMsgID,
		Seq: req.Seq, Status: "recalled",
	}
	if s.Client == nil || !s.Client.Available() {
		return result, ErrIMUnavailable
	}
	req.PeerType = strings.TrimSpace(req.PeerType)
	req.PeerID = strings.TrimSpace(req.PeerID)
	req.ClientMsgID = strings.TrimSpace(req.ClientMsgID)
	req.Reason = strings.TrimSpace(req.Reason)
	result.PeerType, result.PeerID, result.ClientMsgID = req.PeerType, req.PeerID, req.ClientMsgID
	if (req.PeerType != "c2c" && req.PeerType != "group") || req.PeerID == "" ||
		req.ClientMsgID == "" || len(req.ClientMsgID) > 128 || req.Seq <= 0 || len([]rune(req.Reason)) > 500 {
		return result, ErrIMInvalidRecallRequest
	}

	operatorIMID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return result, ErrIMInvalidRecallRequest
	}
	var conversationID, internalGroupID, operatorRole string
	switch req.PeerType {
	case "c2c":
		parsedPeerID, err := uuid.Parse(req.PeerID)
		if err != nil {
			return result, ErrIMInvalidRecallRequest
		}
		req.PeerID = parsedPeerID.String()
		result.PeerID = req.PeerID
		peer, err := s.ResolvePeer(ctx, userID, req.PeerID)
		if err != nil {
			if errors.Is(err, repository.ErrIMTargetNotFound) {
				return result, ErrIMMessageNotFound
			}
			return result, err
		}
		if peer.DenyReason == "sender_inactive" {
			return result, ErrIMRecallForbidden
		}
		conversationID = buildC2CConversationID(operatorIMID, peer.IMUserID)
		operatorRole = "member"
	case "group":
		if strings.IndexFunc(req.PeerID, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return result, ErrIMInvalidRecallRequest
		}
		internalID, publicID, err := s.Groups.LookupGroupIDs(ctx, req.PeerID)
		if errors.Is(err, pgx.ErrNoRows) || publicID != req.PeerID {
			return result, ErrIMMessageNotFound
		}
		if err != nil {
			return result, err
		}
		group, err := s.Access.ResolveGroup(ctx, userID, internalID)
		if errors.Is(err, repository.ErrIMTargetNotFound) || group.DenyReason == "group_inactive" {
			return result, ErrIMRecallForbidden
		}
		if err != nil {
			return result, err
		}
		groupIMID, err := im.UserIDFromBusinessID(internalID)
		if err != nil {
			return result, ErrIMMessageNotFound
		}
		conversationID, err = s.resolveGroupConversationID(ctx, operatorIMID, groupIMID)
		if err != nil {
			return result, fmt.Errorf("%w: %v", ErrIMRecallUpstream, err)
		}
		internalGroupID = internalID
		operatorRole = group.Role
	}

	message, err := s.Access.FindMessageAudit(ctx, conversationID, req.ClientMsgID)
	if err != nil {
		if errors.Is(err, repository.ErrIMMessageNotFound) {
			return result, ErrIMMessageNotFound
		}
		return result, err
	}
	if message.ContentType <= 0 || message.ContentType >= 1000 || message.SenderIMID == s.Config.AdminUser {
		return result, ErrIMUnsupportedMessage
	}
	senderID, err := im.BusinessIDFromUserID(message.SenderIMID)
	if err != nil {
		return result, ErrIMUnsupportedMessage
	}
	senderRole := "member"
	if req.PeerType == "group" {
		operatorRole, senderRole, err = s.Groups.MessageRecallRoles(ctx, internalGroupID, userID, senderID)
		if err != nil {
			if errors.Is(err, repository.ErrForbidden) {
				return result, ErrIMRecallForbidden
			}
			return result, err
		}
	}
	windowSeconds := s.Config.RecallWindowSeconds
	if windowSeconds <= 0 {
		windowSeconds = 120
	}
	if err := validateRecallPermission(req.PeerType, userID == senderID, operatorRole, senderRole,
		req.Reason, message.SendTime, time.Now(), time.Duration(windowSeconds)*time.Second); err != nil {
		return result, err
	}

	reservation, err := s.Access.ReserveMessageRecall(ctx, conversationID, req.Seq, req.ClientMsgID,
		req.PeerType, req.PeerID, message.SenderIMID, userID, operatorIMID, operatorRole, req.Reason)
	if err != nil {
		if errors.Is(err, repository.ErrIMRecallInProgress) {
			return result, ErrIMRecallConflict
		}
		return result, err
	}
	if !reservation.ShouldRecall && reservation.Status == "recalled" {
		result.AlreadyRecalled = true
		if reservation.RecalledAt != nil {
			result.RecalledAt = *reservation.RecalledAt
		} else {
			result.RecalledAt = time.Now()
		}
		return result, nil
	}

	alreadyRecalled, err := s.Client.RevokeMessage(ctx, operatorIMID, conversationID, req.Seq)
	if err != nil {
		_ = s.Access.FailMessageRecall(ctx, reservation.ID, err.Error())
		var apiErr *im.APIError
		if errors.As(err, &apiErr) && apiErr.ErrCode == 1004 {
			return result, ErrIMMessageNotFound
		}
		return result, fmt.Errorf("%w: %v", ErrIMRecallUpstream, err)
	}
	recalledAt, err := s.Access.CompleteMessageRecall(ctx, reservation.ID)
	if err != nil {
		return result, err
	}
	result.AlreadyRecalled = alreadyRecalled
	result.RecalledAt = recalledAt
	return result, nil
}

func validateRecallPermission(peerType string, ownMessage bool, operatorRole, senderRole, reason string, sendTime int64, now time.Time, window time.Duration) error {
	if sendTime <= 0 {
		return ErrIMMessageNotFound
	}
	if ownMessage {
		sentAt := time.UnixMilli(sendTime)
		if sentAt.After(now.Add(5*time.Minute)) || now.Sub(sentAt) > window {
			return ErrIMRecallExpired
		}
		return nil
	}
	if peerType != "group" || strings.TrimSpace(reason) == "" {
		return ErrIMRecallForbidden
	}
	if operatorRole == "owner" && senderRole != "owner" {
		return nil
	}
	if operatorRole == "admin" && senderRole == "member" {
		return nil
	}
	return ErrIMRecallForbidden
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

func (s *IMService) ensureOpenIMGroup(ctx context.Context, requesterID, internalID, imGroupID string) error {
	if s.Client == nil || !s.Client.Available() {
		return nil
	}
	state, err := s.Groups.GetSyncState(ctx, internalID)
	if err != nil {
		return err
	}
	if state.Status != "active" {
		return nil
	}
	ownerID, err := im.UserIDFromBusinessID(state.OwnerID)
	if err != nil {
		return err
	}
	ownerNick, ownerFace := "", ""
	requesterNick, requesterFace := "", ""
	requesterActive := false
	for _, member := range state.Members {
		if member.ID == state.OwnerID {
			ownerNick, ownerFace = member.Nickname, member.Avatar
		}
		if member.ID == requesterID {
			requesterActive = member.Status == "active"
			requesterNick, requesterFace = member.Nickname, member.Avatar
		}
	}
	if err := s.Client.EnsureUser(ctx, im.User{
		UserID: ownerID, Nickname: ownerNick, FaceURL: ownerFace,
	}); err != nil {
		return fmt.Errorf("ensure group owner: %w", err)
	}
	registered, err := s.Client.IsGroupRegistered(ctx, imGroupID)
	if err != nil {
		return err
	}
	if !registered {
		log.Printf("OpenIM group missing, creating from business group %s", internalID)
		if err := s.Client.EnsureGroup(ctx, im.Group{
			GroupID: imGroupID, GroupName: state.Name, Notification: state.Announcement,
			FaceURL: state.Avatar, OwnerUserID: ownerID,
			AllowMemberAddFriend: state.AllowMemberAddFriend,
		}); err != nil {
			return err
		}
	}
	if requesterID == state.OwnerID || !requesterActive {
		return nil
	}
	requesterIMID, err := im.UserIDFromBusinessID(requesterID)
	if err != nil {
		return err
	}
	if err := s.Client.EnsureUser(ctx, im.User{
		UserID: requesterIMID, Nickname: requesterNick, FaceURL: requesterFace,
	}); err != nil {
		return fmt.Errorf("ensure group member: %w", err)
	}
	if err := s.Client.JoinGroup(ctx, requesterIMID, imGroupID); err != nil {
		log.Printf("OpenIM invite member %s for group %s: %v", requesterID, internalID, err)
		registered, checkErr := s.Client.IsGroupRegistered(ctx, imGroupID)
		if checkErr == nil && registered {
			return nil
		}
		return err
	}
	return nil
}

type GroupReadState struct {
	MaxOtherReadSeq int64 `json:"maxOtherReadSeq"`
}

func parseGroupConversationID(conversationID string) (string, error) {
	imGroupID, ok := strings.CutPrefix(strings.TrimSpace(conversationID), "sg_")
	if !ok || imGroupID == "" {
		return "", ErrIMInvalidReadStatusRequest
	}
	groupID, err := im.BusinessIDFromUserID(imGroupID)
	if err != nil {
		return "", ErrIMInvalidReadStatusRequest
	}
	return groupID, nil
}

// ReportGroupReadCursor 每次只向 OpenIM 查询当前阅读者自己的游标，随后单调写入 PostgreSQL/Redis。
// 无论群里 2 人还是 4000 人，每次上报的 OpenIM 请求数都固定为 1。
func (s *IMService) ReportGroupReadCursor(ctx context.Context, callerUserID, conversationID string) (int64, error) {
	if s.Client == nil || !s.Client.Available() || s.ReadCursors == nil {
		return 0, ErrIMUnavailable
	}
	groupID, err := parseGroupConversationID(conversationID)
	if err != nil {
		return 0, err
	}
	ok, err := s.ReadCursors.IsActiveMember(ctx, groupID, callerUserID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, ErrIMNotGroupMember
	}
	callerIMID, err := im.UserIDFromBusinessID(callerUserID)
	if err != nil {
		return 0, ErrIMInvalidReadStatusRequest
	}
	seq, err := s.Client.GetConversationHasReadSeq(ctx, callerIMID, conversationID)
	if err != nil {
		return 0, err
	}
	if err := s.ReadCursors.Upsert(ctx, conversationID, groupID, callerUserID, seq); err != nil {
		return 0, err
	}
	if cache, ok := s.TokenCache.(IMGroupReadCursorCache); ok {
		_ = cache.GroupReadCursorUpsert(ctx, imGroupReadCursorPrefix+conversationID, callerUserID, seq)
	}
	return seq, nil
}

// GroupReadState 读取“除发送者外的最高已读游标”。消息 seq 不大于它时，即至少一人已读。
func (s *IMService) GroupReadState(ctx context.Context, callerUserID, conversationID string) (GroupReadState, error) {
	if s.ReadCursors == nil {
		return GroupReadState{}, ErrIMUnavailable
	}
	groupID, err := parseGroupConversationID(conversationID)
	if err != nil {
		return GroupReadState{}, err
	}
	ok, err := s.ReadCursors.IsActiveMember(ctx, groupID, callerUserID)
	if err != nil {
		return GroupReadState{}, err
	}
	if !ok {
		return GroupReadState{}, ErrIMNotGroupMember
	}
	if cache, ok := s.TokenCache.(IMGroupReadCursorCache); ok {
		if seq, found, cacheErr := cache.GroupReadCursorMaxOther(ctx, imGroupReadCursorPrefix+conversationID, callerUserID); cacheErr == nil && found {
			return GroupReadState{MaxOtherReadSeq: seq}, nil
		}
	}
	seq, err := s.ReadCursors.MaxOther(ctx, conversationID, callerUserID)
	return GroupReadState{MaxOtherReadSeq: seq}, err
}
