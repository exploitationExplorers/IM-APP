package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

type IMSyncWorker struct {
	Outbox       *repository.IMSyncOutboxRepo
	Users        *repository.UserRepo
	Groups       *repository.GroupRepo
	Access       *repository.IMAccessRepo
	Client       *im.Client
	WorkerID     string
	BatchSize    int
	MaxAttempts  int
	PollInterval time.Duration
}

func (w *IMSyncWorker) Run(ctx context.Context) {
	if w.Client == nil || !w.Client.Available() {
		log.Println("OpenIM registration sync disabled: configuration is incomplete")
		return
	}
	if w.WorkerID == "" {
		w.WorkerID = "openim-register-" + uuid.NewString()
	}
	if w.BatchSize <= 0 {
		w.BatchSize = 20
	}
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 10
	}
	if w.PollInterval <= 0 {
		w.PollInterval = 2 * time.Second
	}

	ticker := time.NewTicker(w.PollInterval)
	defer ticker.Stop()
	for {
		if err := w.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("OpenIM registration sync: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *IMSyncWorker) RunOnce(ctx context.Context) error {
	events, err := w.Outbox.ClaimBatch(ctx, w.WorkerID, w.BatchSize)
	if err != nil {
		return err
	}
	for _, event := range events {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := w.syncEvent(ctx, event); err != nil {
			message := truncateError(err.Error(), 2000)
			if markErr := w.Outbox.MarkFailed(ctx, event, w.WorkerID, message, time.Now().Add(retryDelay(event.AttemptCount)), w.MaxAttempts); markErr != nil {
				return fmt.Errorf("mark OpenIM registration event %d failed: %w", event.ID, markErr)
			}
			continue
		}
		if err := w.Outbox.MarkCompleted(ctx, event.ID, w.WorkerID); err != nil {
			return fmt.Errorf("complete OpenIM registration event %d: %w", event.ID, err)
		}
	}
	return nil
}

func (w *IMSyncWorker) syncEvent(ctx context.Context, event repository.IMSyncEvent) error {
	switch event.EventType {
	case repository.IMEventUserRegistered, repository.IMEventUserProfileUpdated:
		return w.syncUser(ctx, event.AggregateID)
	case repository.IMEventFriendAccepted, repository.IMEventFriendDeleted,
		repository.IMEventBlockAdded, repository.IMEventBlockRemoved:
		return w.syncRelationship(ctx, event)
	case repository.IMEventGroupCreated, repository.IMEventGroupUpdated,
		repository.IMEventGroupMemberJoined, repository.IMEventGroupMemberLeft,
		repository.IMEventGroupMemberRole, repository.IMEventGroupMemberMute,
		repository.IMEventGroupMemberProfile,
		repository.IMEventGroupMute, repository.IMEventGroupDismissed:
		return w.syncGroup(ctx, event)
	default:
		return fmt.Errorf("unsupported OpenIM sync event type %q", event.EventType)
	}
}

func (w *IMSyncWorker) syncUser(ctx context.Context, businessUserID string) error {
	user, err := w.Users.FindByID(ctx, businessUserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if user.Status != "active" {
		return nil
	}
	openIMUserID, err := im.UserIDFromBusinessID(user.ID)
	if err != nil {
		return err
	}
	return w.Client.EnsureUser(ctx, im.User{
		UserID: openIMUserID, Nickname: user.Nickname, FaceURL: user.Avatar,
	})
}

func (w *IMSyncWorker) syncRelationship(ctx context.Context, event repository.IMSyncEvent) error {
	var payload struct {
		FriendUserID  string `json:"friendUserId"`
		BlockedUserID string `json:"blockedUserId"`
	}
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return fmt.Errorf("decode %s payload: %w", event.EventType, err)
	}
	ownerID, err := im.UserIDFromBusinessID(event.AggregateID)
	if err != nil {
		return err
	}
	switch event.EventType {
	case repository.IMEventFriendAccepted:
		friendID, err := im.UserIDFromBusinessID(payload.FriendUserID)
		if err != nil {
			return err
		}
		return w.syncFriendshipState(ctx, event.AggregateID, payload.FriendUserID, ownerID, friendID)
	case repository.IMEventFriendDeleted:
		friendID, err := im.UserIDFromBusinessID(payload.FriendUserID)
		if err != nil {
			return err
		}
		return w.syncFriendshipState(ctx, event.AggregateID, payload.FriendUserID, ownerID, friendID)
	case repository.IMEventBlockAdded:
		blockedID, err := im.UserIDFromBusinessID(payload.BlockedUserID)
		if err != nil {
			return err
		}
		return w.syncBlockState(ctx, event.AggregateID, payload.BlockedUserID, ownerID, blockedID)
	case repository.IMEventBlockRemoved:
		blockedID, err := im.UserIDFromBusinessID(payload.BlockedUserID)
		if err != nil {
			return err
		}
		return w.syncBlockState(ctx, event.AggregateID, payload.BlockedUserID, ownerID, blockedID)
	default:
		return fmt.Errorf("unsupported relationship event %q", event.EventType)
	}
}

func (w *IMSyncWorker) syncFriendshipState(ctx context.Context, ownerBusinessID, friendBusinessID, ownerID, friendID string) error {
	isFriend, _, err := w.Outbox.RelationshipState(ctx, ownerBusinessID, friendBusinessID)
	if err != nil {
		return err
	}
	if isFriend {
		if err := w.syncUser(ctx, ownerBusinessID); err != nil {
			return err
		}
		if err := w.syncUser(ctx, friendBusinessID); err != nil {
			return err
		}
		return w.Client.ImportFriends(ctx, ownerID, []string{friendID})
	}
	if err := w.Client.DeleteFriend(ctx, ownerID, friendID); err != nil {
		return err
	}
	return w.Client.DeleteFriend(ctx, friendID, ownerID)
}

func (w *IMSyncWorker) syncBlockState(ctx context.Context, ownerBusinessID, blockedBusinessID, ownerID, blockedID string) error {
	_, blocked, err := w.Outbox.RelationshipState(ctx, ownerBusinessID, blockedBusinessID)
	if err != nil {
		return err
	}
	if blocked {
		return w.Client.AddBlack(ctx, ownerID, blockedID)
	}
	return w.Client.RemoveBlack(ctx, ownerID, blockedID)
}

func (w *IMSyncWorker) syncGroup(ctx context.Context, event repository.IMSyncEvent) error {
	state, err := w.Groups.GetSyncState(ctx, event.AggregateID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	groupID, err := im.UserIDFromBusinessID(state.ID)
	if err != nil {
		return err
	}
	if event.EventType == repository.IMEventGroupDismissed {
		return w.Client.DismissGroup(ctx, groupID)
	}
	if state.Status != "active" {
		return nil
	}
	ownerID, err := im.UserIDFromBusinessID(state.OwnerID)
	if err != nil {
		return err
	}
	group := im.Group{
		GroupID: groupID, GroupName: state.Name, Notification: state.Announcement,
		FaceURL: state.Avatar, OwnerUserID: ownerID,
		AllowMemberAddFriend: state.AllowMemberAddFriend,
	}
	memberByID := make(map[string]models.IMGroupSyncMember, len(state.Members))
	for _, member := range state.Members {
		if member.Status != "active" {
			continue
		}
		memberID, err := im.UserIDFromBusinessID(member.ID)
		if err != nil {
			return err
		}
		memberByID[memberID] = member
		if err := w.Client.EnsureUser(ctx, im.User{
			UserID: memberID, Nickname: member.Nickname, FaceURL: member.Avatar,
		}); err != nil {
			return err
		}
		switch member.Role {
		case "owner":
		case "admin":
			group.AdminUserIDs = append(group.AdminUserIDs, memberID)
		default:
			group.MemberUserIDs = append(group.MemberUserIDs, memberID)
		}
	}

	if event.EventType == repository.IMEventGroupCreated {
		if err := w.Client.EnsureGroup(ctx, group); err != nil {
			return err
		}
		// 建群不要再跑邀请/改昵称/禁言/设角色：这些 OpenIM 通知会计入未读，
		// 会话列表会显示十几条，聊天页又把空通知滤掉，只剩欢迎语。
		return w.sendGroupCreatedWelcome(ctx, state.ID, groupID)
	}
	if event.EventType == repository.IMEventGroupUpdated {
		// 只同步群名/头像/公告/加好友开关。邀请、踢人、角色、禁言各有独立事件；
		// 这里再全量 reconcile 会让 OpenIM 连发系统通知，会话列表未读狂跳、聊天页却看不到气泡。
		return w.Client.EnsureGroup(ctx, group)
	}
	registered, err := w.Client.IsGroupRegistered(ctx, groupID)
	if err != nil {
		return err
	}
	if !registered {
		if err := w.Client.EnsureGroup(ctx, group); err != nil {
			return err
		}
	}
	if event.EventType == repository.IMEventGroupMute {
		return w.Client.SetGroupMute(ctx, groupID, state.AllMuted)
	}
	var payload struct {
		UserID       string `json:"userId"`
		Role         string `json:"role"`
		MutedSeconds int64  `json:"mutedSeconds"`
	}
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return fmt.Errorf("decode %s payload: %w", event.EventType, err)
	}
	memberID, err := im.UserIDFromBusinessID(payload.UserID)
	if err != nil {
		return err
	}
	if event.EventType == repository.IMEventGroupMemberRole {
		member, exists := memberByID[memberID]
		if !exists {
			return nil
		}
		roleLevel := 20
		if member.Role == "admin" {
			roleLevel = 60
		}
		return w.Client.SetGroupMemberRole(ctx, groupID, memberID, roleLevel)
	}
	if event.EventType == repository.IMEventGroupMemberMute {
		member, exists := memberByID[memberID]
		if !exists {
			return nil
		}
		return w.Client.SetGroupMemberMute(ctx, groupID, memberID, remainingMuteSeconds(member.MutedUntil))
	}
	if event.EventType == repository.IMEventGroupMemberProfile {
		member, exists := memberByID[memberID]
		if !exists {
			return nil
		}
		return w.Client.SetGroupMemberNickname(ctx, groupID, memberID, member.GroupNickname)
	}
	if _, exists := memberByID[memberID]; exists {
		return w.Client.InviteGroupMember(ctx, groupID, []string{memberID})
	}
	return w.Client.KickGroupMember(ctx, groupID, []string{memberID})
}

func (w *IMSyncWorker) sendGroupCreatedWelcome(ctx context.Context, businessGroupID, imGroupID string) error {
	if w.Access == nil || w.Client == nil {
		return nil
	}
	key := "group-created-welcome:" + businessGroupID
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte("text:"+models.GroupCreatedWelcomeText)))
	reservation, err := w.Access.ReserveSystemMessage(ctx, key, "group", businessGroupID, "text", hash)
	if err != nil {
		return err
	}
	if reservation.Status == "sent" || !reservation.ShouldSend {
		return nil
	}
	sent, err := w.Client.SendTextMessage(ctx, imGroupID, 3, models.GroupCreatedWelcomeText)
	if err != nil {
		_ = w.Access.FailSystemMessage(ctx, reservation.ID, truncateError(err.Error(), 2000))
		return err
	}
	return w.Access.CompleteSystemMessage(ctx, reservation.ID, sent.ServerMsgID, sent.ClientMsgID)
}

func remainingMuteSeconds(until *time.Time) int64 {
	if until == nil || !until.After(time.Now()) {
		return 0
	}
	seconds := int64(time.Until(*until).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}

func retryDelay(attempt int) time.Duration {
	seconds := math.Pow(2, float64(max(0, attempt-1))) * 5
	return time.Duration(min(seconds, 30*60)) * time.Second
}

func truncateError(message string, limit int) string {
	message = strings.TrimSpace(message)
	if len(message) <= limit {
		return message
	}
	return message[:limit]
}
