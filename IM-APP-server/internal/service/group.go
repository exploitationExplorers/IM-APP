package service

import (
	"context"
	"errors"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

type GroupService struct {
	Groups *repository.GroupRepo
}

func (s *GroupService) Create(ctx context.Context, uid, name string, memberIDs []string) (models.GroupInfo, error) {
	if name == "" {
		return models.GroupInfo{}, errors.New("群名称不能为空")
	}
	return s.Groups.Create(ctx, uid, name, memberIDs)
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
