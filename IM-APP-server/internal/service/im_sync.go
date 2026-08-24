package service

import (
	"context"
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
	group, memberByID, err := w.buildGroupFromState(state)
	if err != nil {
		return err
	}

	switch event.EventType {
	case repository.IMEventGroupCreated:
		if err := w.ensureGroupMembersRegistered(ctx, state.Members); err != nil {
			return err
		}
		// 欢迎语由 OpenIM 群创建通知（contentType 1501）以系统消息展示；
		// 不再用 imAdmin 发文本气泡，否则会出现「假用户」头像且点资料失败。
		return w.Client.EnsureGroup(ctx, group)
	case repository.IMEventGroupUpdated:
		var updatePayload repository.IMGroupUpdatePayload
		if err := json.Unmarshal(event.Payload, &updatePayload); err != nil {
			return fmt.Errorf("decode %s payload: %w", event.EventType, err)
		}
		if updatePayload.Name == nil && updatePayload.Avatar == nil && updatePayload.Announcement == nil && updatePayload.AllowMemberAddFriend == nil {
			return nil
		}
		registered, err := w.Client.IsGroupRegistered(ctx, groupID)
		if err != nil {
			return err
		}
		if !registered {
			if err := w.ensureGroupMembersRegistered(ctx, state.Members); err != nil {
				return err
			}
			return w.Client.EnsureGroup(ctx, group)
		}
		return w.Client.UpdateGroup(ctx, groupID, im.GroupUpdate{
			GroupName:            updatePayload.Name,
			FaceURL:              updatePayload.Avatar,
			Notification:         updatePayload.Announcement,
			AllowMemberAddFriend: updatePayload.AllowMemberAddFriend,
		})
	}

	registered, err := w.Client.IsGroupRegistered(ctx, groupID)
	if err != nil {
		return err
	}
	if !registered {
		if err := w.ensureGroupMembersRegistered(ctx, state.Members); err != nil {
			return err
		}
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
		Reason       string `json:"reason"`
		OperatorID   string `json:"operatorId"`
	}
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return fmt.Errorf("decode %s payload: %w", event.EventType, err)
	}
	memberID, err := im.UserIDFromBusinessID(payload.UserID)
	if err != nil {
		return err
	}
	operatorID := ""
	if payload.OperatorID != "" {
		operatorID, err = im.UserIDFromBusinessID(payload.OperatorID)
		if err != nil {
			return err
		}
	}

	switch event.EventType {
	case repository.IMEventGroupMemberJoined:
		if err := w.ensureSingleMemberRegistered(ctx, state.Members, payload.UserID); err != nil {
			return err
		}
		if _, exists := memberByID[memberID]; !exists {
			return nil
		}
		if payload.Reason == "invite" {
			return w.Client.InviteGroupMemberAs(ctx, operatorID, groupID, []string{memberID})
		}
		return w.Client.JoinGroup(ctx, memberID, groupID)
	case repository.IMEventGroupMemberLeft:
		if _, exists := memberByID[memberID]; exists {
			return nil
		}
		if payload.Reason == "kick" {
			return w.Client.KickGroupMemberAs(ctx, operatorID, groupID, []string{memberID})
		}
		return w.Client.QuitGroup(ctx, memberID, groupID)
	case repository.IMEventGroupMemberRole:
		member, exists := memberByID[memberID]
		if !exists {
			return nil
		}
		roleLevel := 20
		if member.Role == "admin" {
			roleLevel = 60
		}
		return w.Client.SetGroupMemberRole(ctx, groupID, memberID, roleLevel)
	case repository.IMEventGroupMemberMute:
		member, exists := memberByID[memberID]
		if !exists {
			return nil
		}
		return w.Client.SetGroupMemberMute(ctx, groupID, memberID, remainingMuteSeconds(member.MutedUntil))
	case repository.IMEventGroupMemberProfile:
		if err := w.ensureSingleMemberRegistered(ctx, state.Members, payload.UserID); err != nil {
			return err
		}
		member, exists := memberByID[memberID]
		if !exists {
			return nil
		}
		return w.Client.SetGroupMemberNickname(ctx, groupID, memberID, member.GroupNickname)
	default:
		return fmt.Errorf("unsupported OpenIM group event type %q", event.EventType)
	}
}

func (w *IMSyncWorker) buildGroupFromState(state models.IMGroupSyncState) (im.Group, map[string]models.IMGroupSyncMember, error) {
	ownerID, err := im.UserIDFromBusinessID(state.OwnerID)
	if err != nil {
		return im.Group{}, nil, err
	}
	groupID, err := im.UserIDFromBusinessID(state.ID)
	if err != nil {
		return im.Group{}, nil, err
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
			return im.Group{}, nil, err
		}
		memberByID[memberID] = member
		switch member.Role {
		case "owner":
		case "admin":
			group.AdminUserIDs = append(group.AdminUserIDs, memberID)
		default:
			group.MemberUserIDs = append(group.MemberUserIDs, memberID)
		}
	}
	return group, memberByID, nil
}

func (w *IMSyncWorker) ensureGroupMembersRegistered(ctx context.Context, members []models.IMGroupSyncMember) error {
	users := make([]im.User, 0, len(members))
	for _, member := range members {
		if member.Status != "active" {
			continue
		}
		memberID, err := im.UserIDFromBusinessID(member.ID)
		if err != nil {
			return err
		}
		users = append(users, im.User{
			UserID: memberID, Nickname: member.Nickname, FaceURL: member.Avatar,
		})
	}
	return w.Client.EnsureUsersBatch(ctx, users)
}

func (w *IMSyncWorker) ensureSingleMemberRegistered(ctx context.Context, members []models.IMGroupSyncMember, businessUserID string) error {
	for _, member := range members {
		if member.ID != businessUserID || member.Status != "active" {
			continue
		}
		memberID, err := im.UserIDFromBusinessID(member.ID)
		if err != nil {
			return err
		}
		return w.Client.EnsureUser(ctx, im.User{
			UserID: memberID, Nickname: member.Nickname, FaceURL: member.Avatar,
		})
	}
	return nil
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
