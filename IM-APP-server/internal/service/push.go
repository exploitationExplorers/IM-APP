package service

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"im-app-server/internal/im"
)

// PushToken 是前端设备注册到后端的推送凭证。
// 当 App 处于后台/离线时，后端可经 APNs / FCM / 个推 / 鸿蒙 等通道
// 向这些设备下发「来消息提示」推送。
type PushToken struct {
	Platform    string `json:"platform"`    // ios / android / web / harmony
	Channel     string `json:"channel"`     // apns / fcm / jpush / harmony / 空(web 走浏览器推送)
	DeviceToken string `json:"deviceToken"` // 设备推送令牌（iOS deviceToken / FCM registration token 等）
	Enabled     bool   `json:"enabled"`     // 是否接收推送
	UpdatedAt   int64  `json:"updatedAt"`   // 最近更新时间（Unix 秒）
}

// key 用于在同一用户下按「平台+设备令牌」去重 upsert。
func (t PushToken) key() string { return t.Platform + ":" + t.DeviceToken }

const pushTokenKeyPrefix = "openim:push-tokens:v1:"

// pushTokenKey 设备令牌在 Redis 中的 key，按 OpenIM 用户 ID 维度隔离。
func pushTokenKey(openIMUserID string) string {
	return pushTokenKeyPrefix + openIMUserID
}

// RegisterPushToken 注册或更新某设备的推送凭证。
// 按 Platform+DeviceToken 去重：已存在则覆盖，否则追加。Redis 不可用时返回 ErrIMUnavailable。
func (s *IMService) RegisterPushToken(ctx context.Context, userID string, token PushToken) error {
	opUserID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return err
	}
	if token.DeviceToken == "" {
		return errors.New("deviceToken 不能为空")
	}
	if token.Platform == "" {
		return errors.New("platform 不能为空")
	}
	token.Enabled = true
	token.UpdatedAt = time.Now().Unix()

	if s.TokenCache == nil || !s.TokenCache.Available() {
		return ErrIMUnavailable
	}
	list, err := s.listPushTokens(ctx, opUserID)
	if err != nil {
		return err
	}
	found := false
	for i := range list {
		if list[i].key() == token.key() {
			list[i] = token
			found = true
			break
		}
	}
	if !found {
		list = append(list, token)
	}
	return s.savePushTokens(ctx, opUserID, list)
}

// UnregisterPushToken 按 deviceToken 注销某设备的推送凭证。
func (s *IMService) UnregisterPushToken(ctx context.Context, userID, deviceToken string) error {
	opUserID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return err
	}
	if deviceToken == "" {
		return errors.New("deviceToken 不能为空")
	}
	if s.TokenCache == nil || !s.TokenCache.Available() {
		return ErrIMUnavailable
	}
	list, err := s.listPushTokens(ctx, opUserID)
	if err != nil {
		return err
	}
	filtered := list[:0]
	for _, t := range list {
		if t.DeviceToken != deviceToken {
			filtered = append(filtered, t)
		}
	}
	return s.savePushTokens(ctx, opUserID, filtered)
}

// ListPushTokens 返回该用户已注册的全部设备推送凭证。
func (s *IMService) ListPushTokens(ctx context.Context, userID string) ([]PushToken, error) {
	opUserID, err := im.UserIDFromBusinessID(userID)
	if err != nil {
		return nil, err
	}
	return s.listPushTokens(ctx, opUserID)
}

// listPushTokens 从 Redis 读取并反序列化设备令牌列表（不存在时返回空切片）。
func (s *IMService) listPushTokens(ctx context.Context, openIMUserID string) ([]PushToken, error) {
	raw, found, err := s.TokenCache.CacheGet(ctx, pushTokenKey(openIMUserID))
	if err != nil {
		return nil, err
	}
	if !found || raw == "" {
		return nil, nil
	}
	var list []PushToken
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		log.Printf("openim push tokens decode failed: %v", err)
		return nil, nil
	}
	return list, nil
}

// savePushTokens 将设备令牌列表序列化写回 Redis（TTL=0 表示不过期）。
func (s *IMService) savePushTokens(ctx context.Context, openIMUserID string, list []PushToken) error {
	payload, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return s.TokenCache.CacheSet(ctx, pushTokenKey(openIMUserID), string(payload), 0)
}

// ---------------------------------------------------------------------------
// 消息推送管线（PushService）
// ---------------------------------------------------------------------------

// PushMessage 是「一条需要下发推送的消息」的抽象，由 OpenIM AfterMessage 回调构造。
type PushMessage struct {
	ConversationID string   // 会话 ID（si_xxx / sg_xxx）
	SenderOpenIMID string   // 发送方 OpenIM ID
	RecvOpenIMIDs  []string // 需要接收推送的接收方 OpenIM ID（不含发送方）
	GroupID        string   // 群 ID（群消息时非空）
	ContentType    int      // 消息类型（101=文本 等）
	Snippet        string   // 推送展示摘要（webhook 未携带正文时为 ""）
	SendTime       int64    // 发送时间（Unix 毫秒）
}

// PushService 是「消息推送」的抽象。OpenIM 在消息落库后回调 AfterMessage，
// 后端据此向离线/后台用户下发推送（来消息提示）。
// 真实实现应持有设备令牌仓库（PushToken）与 APNs/FCM/个推 等通道客户端；
// 当前为日志桩，仅打印意图，便于联调，不真正下发。
type PushService interface {
	Dispatch(ctx context.Context, msg PushMessage) error
}

// LoggingPushService 仅记录推送意图，不真正下发。生产环境替换为接入 APNs/FCM 的实现。
type LoggingPushService struct{}

// NewLoggingPushService 构造日志桩推送服务。
func NewLoggingPushService() *LoggingPushService { return &LoggingPushService{} }

func (p *LoggingPushService) Dispatch(ctx context.Context, msg PushMessage) error {
	log.Printf("[push:stub] conversation=%s sender=%s recv=%v group=%s contentType=%d sendTime=%d",
		msg.ConversationID, msg.SenderOpenIMID, msg.RecvOpenIMIDs, msg.GroupID, msg.ContentType, msg.SendTime)
	return nil
}

// NoopPushService 完全不处理推送（未配置推送通道时使用）。
type NoopPushService struct{}

func (p *NoopPushService) Dispatch(ctx context.Context, msg PushMessage) error { return nil }
