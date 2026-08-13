package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"im-app-server/internal/config"
	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrIMUnavailable     = errors.New("OpenIM service is unavailable")
	ErrIMAccountInactive = errors.New("account is not active")
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
