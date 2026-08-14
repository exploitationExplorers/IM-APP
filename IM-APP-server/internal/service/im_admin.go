package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var ErrIMRequestInProgress = errors.New("IM system message is already in progress")

var ErrIMInvalidRequest = errors.New("invalid IM request")

type IMAdminService struct {
	Client *im.Client
	Users  *repository.UserRepo
	Groups *repository.GroupRepo
	Access *repository.IMAccessRepo
	Outbox *repository.IMSyncOutboxRepo
}

func (s *IMAdminService) SendSystemMessage(ctx context.Context, req models.IMSystemMessageRequest) (models.IMSystemMessageResult, error) {
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.IdempotencyKey == "" || len(req.IdempotencyKey) > 128 {
		return models.IMSystemMessageResult{}, fmt.Errorf("%w: invalid idempotencyKey", ErrIMInvalidRequest)
	}
	if req.ReceiverType != "user" && req.ReceiverType != "group" {
		return models.IMSystemMessageResult{}, fmt.Errorf("%w: invalid receiverType", ErrIMInvalidRequest)
	}
	if req.MessageType != "text" && req.MessageType != "custom" {
		return models.IMSystemMessageResult{}, fmt.Errorf("%w: invalid messageType", ErrIMInvalidRequest)
	}
	if req.MessageType == "text" && strings.TrimSpace(req.Text) == "" {
		return models.IMSystemMessageResult{}, fmt.Errorf("%w: text is required", ErrIMInvalidRequest)
	}
	if req.MessageType == "custom" && (strings.TrimSpace(req.Key) == "" || len(req.Data) == 0 || !json.Valid(req.Data)) {
		return models.IMSystemMessageResult{}, fmt.Errorf("%w: custom key and valid data are required", ErrIMInvalidRequest)
	}
	if !s.Client.Available() {
		return models.IMSystemMessageResult{}, ErrIMUnavailable
	}

	receiverID, err := s.resolveReceiver(ctx, req.ReceiverType, req.ReceiverBusinessID)
	if err != nil {
		return models.IMSystemMessageResult{}, err
	}
	requestHash, err := hashSystemMessageRequest(req)
	if err != nil {
		return models.IMSystemMessageResult{}, err
	}
	reservation, err := s.Access.ReserveSystemMessage(ctx, req.IdempotencyKey, req.ReceiverType, req.ReceiverBusinessID, req.MessageType, requestHash)
	if err != nil {
		return models.IMSystemMessageResult{}, err
	}
	result := models.IMSystemMessageResult{
		IdempotencyKey: req.IdempotencyKey, Status: reservation.Status,
		ServerMsgID: reservation.ServerMsgID, ClientMsgID: reservation.ClientMsgID,
	}
	if reservation.Status == "sent" {
		return result, nil
	}
	if !reservation.ShouldSend {
		return result, ErrIMRequestInProgress
	}

	var sent im.SendMessageResult
	if req.MessageType == "text" {
		sessionType := 1
		if req.ReceiverType == "group" {
			sessionType = 3
		}
		sent, err = s.Client.SendTextMessage(ctx, receiverID, sessionType, req.Text)
	} else {
		userID, groupID := "", ""
		if req.ReceiverType == "user" {
			userID = receiverID
		} else {
			groupID = receiverID
		}
		sent, err = s.Client.SendBusinessNotification(ctx, userID, groupID, req.Key, string(req.Data), req.Guaranteed)
	}
	if err != nil {
		_ = s.Access.FailSystemMessage(ctx, reservation.ID, truncateError(err.Error(), 2000))
		return models.IMSystemMessageResult{}, err
	}
	if err := s.Access.CompleteSystemMessage(ctx, reservation.ID, sent.ServerMsgID, sent.ClientMsgID); err != nil {
		return models.IMSystemMessageResult{}, err
	}
	return models.IMSystemMessageResult{
		IdempotencyKey: req.IdempotencyKey, Status: "sent",
		ServerMsgID: sent.ServerMsgID, ClientMsgID: sent.ClientMsgID,
	}, nil
}

func (s *IMAdminService) Reconcile(ctx context.Context) (models.IMReconcileResult, error) {
	return s.Outbox.EnqueueReconciliation(ctx)
}

func (s *IMAdminService) ListOutbox(ctx context.Context, status string, limit int) ([]models.IMOutboxItem, error) {
	switch status {
	case "", "pending", "processing", "retry", "completed", "dead":
	default:
		return nil, ErrIMInvalidRequest
	}
	return s.Outbox.List(ctx, status, limit)
}

func (s *IMAdminService) ReplayDead(ctx context.Context, id int64) (bool, error) {
	if id <= 0 {
		return false, ErrIMInvalidRequest
	}
	return s.Outbox.ReplayDead(ctx, id)
}

func hashSystemMessageRequest(req models.IMSystemMessageRequest) (string, error) {
	req.IdempotencyKey = ""
	raw, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw)), nil
}

func (s *IMAdminService) resolveReceiver(ctx context.Context, receiverType, businessID string) (string, error) {
	receiverID, err := im.UserIDFromBusinessID(businessID)
	if err != nil {
		return "", repository.ErrIMTargetNotFound
	}
	if receiverType == "user" {
		user, err := s.Users.FindByID(ctx, businessID)
		if err != nil || user.Status != "active" {
			return "", repository.ErrIMTargetNotFound
		}
		if err := s.Client.EnsureUser(ctx, im.User{UserID: receiverID, Nickname: user.Nickname, FaceURL: user.Avatar}); err != nil {
			return "", err
		}
		return receiverID, nil
	}
	group, err := s.Groups.GetSyncState(ctx, businessID)
	if err != nil || group.Status != "active" {
		return "", repository.ErrIMTargetNotFound
	}
	registered, err := s.Client.IsGroupRegistered(ctx, receiverID)
	if err != nil {
		return "", err
	}
	if !registered {
		return "", fmt.Errorf("OpenIM group is not synchronized")
	}
	return receiverID, nil
}

func (s *IMAdminService) Health(ctx context.Context) models.IMHealth {
	health := models.IMHealth{Configured: s.Client != nil && s.Client.Available()}
	pending, dead, err := s.Outbox.StatusCounts(ctx)
	if err == nil {
		health.OutboxPending = pending
		health.OutboxDead = dead
	}
	if !health.Configured {
		return health
	}
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if _, err := s.Client.GetAdminToken(checkCtx); err == nil {
		health.APIReachable = true
		health.AdminTokenAvailable = true
	}
	return health
}
