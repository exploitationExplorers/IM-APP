package service

import (
	"context"
	"log"
)

// SMSGateway sends real SMS via third-party provider (Phase 5).
type SMSGateway interface {
	Send(ctx context.Context, phone, countryCode, code, scene string) error
}

// DevSMSGateway logs SMS in dev; production replaces with Aliyun/Twilio etc.
type DevSMSGateway struct{}

func (DevSMSGateway) Send(ctx context.Context, phone, countryCode, code, scene string) error {
	log.Printf("[sms-dev] phone=%s country=%s scene=%s code=%s", phone, countryCode, scene, code)
	return nil
}
