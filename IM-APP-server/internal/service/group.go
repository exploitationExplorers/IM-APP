package service

import (
	"context"
	"errors"
	"time"

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

func (s *GroupService) UpdateSettings(ctx context.Context, groupID, uid string, announcement *string, allow *bool, joinMode *string, allMuted *bool) error {
	return s.Groups.UpdateSettings(ctx, groupID, uid, announcement, allow, joinMode, allMuted)
}

func (s *GroupService) Leave(ctx context.Context, groupID, uid string) error {
	return s.Groups.Leave(ctx, groupID, uid)
}

func (s *GroupService) Qrcode(ctx context.Context, groupID, uid string) (models.GroupQRCodeResult, error) {
	return s.Groups.EnsureQRCode(ctx, groupID, uid)
}

func (s *GroupService) ResolveQRCode(ctx context.Context, uid, token string) (models.GroupQRCodeResolveResult, error) {
	if token == "" {
		return models.GroupQRCodeResolveResult{}, errors.New("无效的二维码")
	}
	return s.Groups.ResolveQRCode(ctx, uid, token)
}

func (s *GroupService) InviteMembers(ctx context.Context, groupID, uid string, userIDs []string) (int, error) {
	return s.Groups.InviteMembers(ctx, groupID, uid, userIDs)
}

func (s *GroupService) AcceptInvitation(ctx context.Context, uid, token string) (models.GroupInfo, error) {
	return s.Groups.AcceptInvitation(ctx, uid, token)
}

func (s *GroupService) CreateJoinRequest(ctx context.Context, groupID, uid, remark string) (models.GroupJoinRequestItem, error) {
	return s.Groups.CreateJoinRequest(ctx, groupID, uid, remark)
}

func (s *GroupService) ListJoinRequests(ctx context.Context, groupID, uid string) ([]models.GroupJoinRequestItem, error) {
	return s.Groups.ListJoinRequests(ctx, groupID, uid)
}

func (s *GroupService) ApproveJoinRequest(ctx context.Context, groupID, uid, requestID string) (models.GroupInfo, error) {
	return s.Groups.ApproveJoinRequest(ctx, groupID, uid, requestID)
}

func (s *GroupService) RejectJoinRequest(ctx context.Context, groupID, uid, requestID string) error {
	return s.Groups.RejectJoinRequest(ctx, groupID, uid, requestID)
}

func (s *GroupService) UpdateMemberRole(ctx context.Context, groupID, uid, targetID, role string) error {
	return s.Groups.UpdateMemberRole(ctx, groupID, uid, targetID, role)
}

func (s *GroupService) RemoveMember(ctx context.Context, groupID, uid, targetID string) error {
	return s.Groups.RemoveMember(ctx, groupID, uid, targetID)
}

func (s *GroupService) Dissolve(ctx context.Context, groupID, uid string) error {
	return s.Groups.Dissolve(ctx, groupID, uid)
}

func (s *GroupService) MuteMember(ctx context.Context, groupID, uid, targetID string, mutedUntil *time.Time) error {
	return s.Groups.MuteMember(ctx, groupID, uid, targetID, mutedUntil)
}
