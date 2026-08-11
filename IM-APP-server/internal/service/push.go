package service

import (
	"context"
	"log"
)

// PushService sends offline push notifications (Phase 5).
type PushService interface {
	PushToUser(ctx context.Context, userID, title, body string, data map[string]string) error
}

// DevPushService logs push in dev; production uses vendor SDK (APNs/FCM/厂商通道).
type DevPushService struct{}

func (DevPushService) PushToUser(ctx context.Context, userID, title, body string, data map[string]string) error {
	log.Printf("[push-dev] user=%s title=%s body=%s data=%v", userID, title, body, data)
	return nil
}
