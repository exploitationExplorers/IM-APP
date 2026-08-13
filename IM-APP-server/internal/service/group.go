package service

import (
	"context"
	"strings"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

type GroupService struct {
	Groups *repository.GroupRepo
}

func (s *GroupService) Create(ctx context.Context, uid, name string, memberIDs []string) (models.GroupInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return models.GroupInfo{}, repository.ErrInvalidGroupOperation
	}
	unique := map[string]struct{}{uid: {}}
	filtered := make([]string, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		memberID = strings.TrimSpace(memberID)
		if _, err := uuid.Parse(memberID); err != nil {
			return models.GroupInfo{}, repository.ErrInvalidGroupOperation
		}
		if _, exists := unique[memberID]; exists {
			continue
		}
		unique[memberID] = struct{}{}
		filtered = append(filtered, memberID)
	}
	if len(unique) < 3 {
		return models.GroupInfo{}, repository.ErrInvalidGroupOperation
	}
	return s.Groups.Create(ctx, uid, name, filtered)
}

func (s *GroupService) GetDetail(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	return s.Groups.GetByID(ctx, groupID, uid)
}

func (s *GroupService) ListMembers(ctx context.Context, groupID, uid string) ([]models.GroupMember, error) {
	return s.Groups.ListMembers(ctx, groupID, uid)
}

func (s *GroupService) Join(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	return s.Groups.Join(ctx, groupID, uid)
}

func (s *GroupService) UpdateSettings(ctx context.Context, groupID, uid string, announcement *string, allow *bool) error {
	return s.Groups.UpdateSettings(ctx, groupID, uid, announcement, allow)
}

func (s *GroupService) Leave(ctx context.Context, groupID, uid string) error {
	return s.Groups.Leave(ctx, groupID, uid)
}

func (s *GroupService) UpdateMemberRole(ctx context.Context, groupID, operatorID, memberID, role string) error {
	return s.Groups.UpdateMemberRole(ctx, groupID, operatorID, memberID, role)
}

func (s *GroupService) UpdateMemberMute(ctx context.Context, groupID, operatorID, memberID string, mutedSeconds int64) error {
	return s.Groups.UpdateMemberMute(ctx, groupID, operatorID, memberID, mutedSeconds)
}

func (s *GroupService) UpdateGroupMute(ctx context.Context, groupID, operatorID string, muted bool) error {
	return s.Groups.UpdateGroupMute(ctx, groupID, operatorID, muted)
}

func (s *GroupService) Dismiss(ctx context.Context, groupID, operatorID string) error {
	return s.Groups.Dismiss(ctx, groupID, operatorID)
}
