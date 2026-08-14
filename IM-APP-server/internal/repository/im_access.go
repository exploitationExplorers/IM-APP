package repository

import (
	"context"
	"errors"
	"time"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrIMTargetNotFound   = errors.New("IM target not found")
	ErrIMAccessDenied     = errors.New("IM access denied")
	ErrIMIdempotencyReuse = errors.New("IM idempotency key was reused for another request")
)

type IMAccessRepo struct {
	DB *pgxpool.Pool
}

func (r *IMAccessRepo) ResolvePeer(ctx context.Context, requesterID, targetID string) (models.IMPeer, error) {
	var result models.IMPeer
	var requesterStatus, targetStatus string
	var isFriend, blocked bool
	err := r.DB.QueryRow(ctx, `
		SELECT target.id::text, target.nickname, target.avatar,
			COALESCE(requester.status,'active'), COALESCE(target.status,'active'),
			EXISTS(SELECT 1 FROM friendships f WHERE f.user_id=$1::uuid AND f.friend_id=target.id),
			EXISTS(
				SELECT 1 FROM user_blocks b
				WHERE (b.user_id=$1::uuid AND b.blocked_id=target.id)
				   OR (b.user_id=target.id AND b.blocked_id=$1::uuid)
			)
		FROM users target
		JOIN users requester ON requester.id=$1::uuid
		WHERE target.id=$2::uuid`, requesterID, targetID,
	).Scan(&result.BusinessUserID, &result.Nickname, &result.Avatar, &requesterStatus, &targetStatus, &isFriend, &blocked)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrIMTargetNotFound
	}
	if err != nil {
		return result, err
	}

	switch {
	case requesterID == targetID:
		result.DenyReason = "self"
	case requesterStatus != "active":
		result.DenyReason = "sender_inactive"
	case targetStatus != "active":
		result.DenyReason = "account_inactive"
	case blocked:
		result.DenyReason = "blocked"
	case !isFriend:
		result.DenyReason = "not_friend"
	default:
		result.CanChat = true
	}
	return result, nil
}

func (r *IMAccessRepo) ResolveGroup(ctx context.Context, userID, groupID string) (models.IMGroupTarget, error) {
	var result models.IMGroupTarget
	var status string
	var allMuted bool
	err := r.DB.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.avatar, COALESCE(g.status,'active'), g.all_muted,
			gm.role, gm.muted_until
		FROM groups g
		JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=$1::uuid
		JOIN users u ON u.id=gm.user_id AND COALESCE(u.status,'active')='active'
		WHERE g.id=$2::uuid`, userID, groupID,
	).Scan(&result.BusinessGroupID, &result.Name, &result.Avatar, &status, &allMuted, &result.Role, &result.MutedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrIMTargetNotFound
	}
	if err != nil {
		return result, err
	}

	switch {
	case status != "active":
		result.DenyReason = "group_inactive"
	case result.MutedUntil != nil && result.MutedUntil.After(time.Now()):
		result.DenyReason = "member_muted"
	case allMuted && result.Role != "owner" && result.Role != "admin":
		result.DenyReason = "group_muted"
	default:
		result.CanChat = true
	}
	return result, nil
}

func (r *IMAccessRepo) RecordMessageAudit(ctx context.Context, command, serverMsgID, clientMsgID, conversationID, senderID, receiverID, groupID string, contentType int, seq, sendTime int64) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO im_message_audit(
			callback_command, server_msg_id, client_msg_id, conversation_id,
			sender_im_id, receiver_im_id, group_im_id, content_type, seq, send_time)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (callback_command, conversation_id, server_msg_id, client_msg_id, seq) DO NOTHING`,
		command, serverMsgID, clientMsgID, conversationID, senderID, receiverID, groupID, contentType, seq, sendTime)
	return err
}

type IMSystemMessageReservation struct {
	ID                 int64
	Status             string
	ServerMsgID        string
	ClientMsgID        string
	ReceiverType       string
	ReceiverBusinessID string
	MessageType        string
	RequestHash        string
	UpdatedAt          time.Time
	ShouldSend         bool
}

func (r *IMAccessRepo) ReserveSystemMessage(ctx context.Context, idempotencyKey, receiverType, receiverBusinessID, messageType, requestHash string) (IMSystemMessageReservation, error) {
	var result IMSystemMessageReservation
	err := r.DB.QueryRow(ctx, `
		INSERT INTO im_system_message_requests(
			idempotency_key, receiver_type, receiver_business_id, message_type, request_hash, status)
		VALUES($1,$2,$3::uuid,$4,$5,'pending')
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, status, server_msg_id, client_msg_id, receiver_type,
			receiver_business_id::text, message_type, request_hash, updated_at`,
		idempotencyKey, receiverType, receiverBusinessID, messageType, requestHash,
	).Scan(&result.ID, &result.Status, &result.ServerMsgID, &result.ClientMsgID,
		&result.ReceiverType, &result.ReceiverBusinessID, &result.MessageType, &result.RequestHash, &result.UpdatedAt)
	if err == nil {
		result.ShouldSend = true
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}

	err = r.DB.QueryRow(ctx, `
		SELECT id, status, server_msg_id, client_msg_id, receiver_type,
			receiver_business_id::text, message_type, request_hash, updated_at
		FROM im_system_message_requests WHERE idempotency_key=$1`, idempotencyKey,
	).Scan(&result.ID, &result.Status, &result.ServerMsgID, &result.ClientMsgID,
		&result.ReceiverType, &result.ReceiverBusinessID, &result.MessageType, &result.RequestHash, &result.UpdatedAt)
	if err != nil {
		return result, err
	}
	if result.ReceiverType != receiverType || result.ReceiverBusinessID != receiverBusinessID ||
		result.MessageType != messageType || result.RequestHash != requestHash {
		return result, ErrIMIdempotencyReuse
	}
	if result.Status == "failed" || (result.Status == "pending" && time.Since(result.UpdatedAt) > time.Minute) {
		tag, err := r.DB.Exec(ctx, `
			UPDATE im_system_message_requests
			SET status='pending', last_error='', updated_at=NOW()
			WHERE id=$1 AND (status='failed' OR (status='pending' AND updated_at < NOW() - INTERVAL '1 minute'))`, result.ID)
		if err != nil {
			return result, err
		}
		result.ShouldSend = tag.RowsAffected() == 1
		if result.ShouldSend {
			result.Status = "pending"
		}
	}
	return result, nil
}

func (r *IMAccessRepo) CompleteSystemMessage(ctx context.Context, id int64, serverMsgID, clientMsgID string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE im_system_message_requests
		SET status='sent', server_msg_id=$2, client_msg_id=$3,
			last_error='', updated_at=NOW()
		WHERE id=$1 AND status='pending'`, id, serverMsgID, clientMsgID)
	return err
}

func (r *IMAccessRepo) FailSystemMessage(ctx context.Context, id int64, message string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE im_system_message_requests
		SET status='failed', last_error=$2, updated_at=NOW()
		WHERE id=$1 AND status='pending'`, id, message)
	return err
}
