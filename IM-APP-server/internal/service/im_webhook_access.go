package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"im-app-server/internal/infra"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

const webhookAccessCacheTTL = 45 * time.Second

// IMWebhookAccess wraps IMAccessRepo with Redis caching for high-QPS webhook checks.
type IMWebhookAccess struct {
	Access *repository.IMAccessRepo
	Redis  *infra.Redis
}

type cachedPeerAccess struct {
	CanChat    bool   `json:"canChat"`
	DenyReason string `json:"denyReason,omitempty"`
}

type cachedGroupAccess struct {
	CanChat    bool   `json:"canChat"`
	DenyReason string `json:"denyReason,omitempty"`
}

func (s *IMWebhookAccess) ResolvePeer(ctx context.Context, requesterID, targetID string) (models.IMPeer, error) {
	if s == nil || s.Access == nil {
		return models.IMPeer{}, repository.ErrIMTargetNotFound
	}
	key := fmt.Sprintf("im:webhook:peer:%s:%s", requesterID, targetID)
	if s.Redis != nil && s.Redis.Available() {
		if raw, ok, err := s.Redis.CacheGet(ctx, key); err == nil && ok {
			var cached cachedPeerAccess
			if json.Unmarshal([]byte(raw), &cached) == nil {
				return models.IMPeer{
					BusinessUserID: targetID,
					CanChat:        cached.CanChat,
					DenyReason:     cached.DenyReason,
				}, nil
			}
		}
	}
	peer, err := s.Access.ResolvePeer(ctx, requesterID, targetID)
	if err != nil {
		return peer, err
	}
	if s.Redis != nil && s.Redis.Available() {
		payload, _ := json.Marshal(cachedPeerAccess{CanChat: peer.CanChat, DenyReason: peer.DenyReason})
		_ = s.Redis.CacheSet(ctx, key, string(payload), webhookAccessCacheTTL)
	}
	return peer, nil
}

func (s *IMWebhookAccess) ResolveGroup(ctx context.Context, userID, groupID string) (models.IMGroupTarget, error) {
	if s == nil || s.Access == nil {
		return models.IMGroupTarget{}, repository.ErrIMTargetNotFound
	}
	key := fmt.Sprintf("im:webhook:group:%s:%s", userID, groupID)
	if s.Redis != nil && s.Redis.Available() {
		if raw, ok, err := s.Redis.CacheGet(ctx, key); err == nil && ok {
			var cached cachedGroupAccess
			if json.Unmarshal([]byte(raw), &cached) == nil {
				return models.IMGroupTarget{
					BusinessGroupID: groupID,
					CanChat:           cached.CanChat,
					DenyReason:        cached.DenyReason,
				}, nil
			}
		}
	}
	group, err := s.Access.ResolveGroup(ctx, userID, groupID)
	if err != nil {
		return group, err
	}
	if s.Redis != nil && s.Redis.Available() {
		payload, _ := json.Marshal(cachedGroupAccess{CanChat: group.CanChat, DenyReason: group.DenyReason})
		_ = s.Redis.CacheSet(ctx, key, string(payload), webhookAccessCacheTTL)
	}
	return group, nil
}
