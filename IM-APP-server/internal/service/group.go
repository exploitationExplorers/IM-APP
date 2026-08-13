package service

import (
	"context"
	"errors"
	"strings"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

type GroupService struct {
	Groups *repository.GroupRepo
}

func (s *GroupService) internalGroupID(ctx context.Context, publicID string) (string, error) {
	publicID = strings.TrimSpace(publicID)
	if publicID == "" || strings.IndexFunc(publicID, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return "", repository.ErrInvalidGroupOperation
	}
	return s.Groups.InternalIDByPublicID(ctx, publicID)
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
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	return s.Groups.GetByID(ctx, internalID, uid)
}

func (s *GroupService) ListMembers(ctx context.Context, groupID, uid string) ([]models.GroupMember, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return s.Groups.ListMembers(ctx, internalID, uid)
}

func (s *GroupService) Join(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	return s.Groups.Join(ctx, internalID, uid)
}

func (s *GroupService) UpdateSettings(ctx context.Context, groupID, uid string, announcement *string, allow *bool, joinMode *string, allMuted *bool) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.UpdateSettings(ctx, internalID, uid, announcement, allow, joinMode, allMuted)
}

func (s *GroupService) Leave(ctx context.Context, groupID, uid string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.Leave(ctx, internalID, uid)
}

func (s *GroupService) Qrcode(ctx context.Context, groupID, uid string) (models.GroupQRCodeResult, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupQRCodeResult{}, err
	}
	result, err := s.Groups.EnsureQRCode(ctx, internalID, uid)
	if err == nil {
		result.GroupID = groupID
	}
	return result, err
}

func (s *GroupService) ResolveQRCode(ctx context.Context, uid, token string) (models.GroupQRCodeResolveResult, error) {
	if token == "" {
		return models.GroupQRCodeResolveResult{}, errors.New("无效的二维码")
	}
	return s.Groups.ResolveQRCode(ctx, uid, token)
}

func (s *GroupService) InviteMembers(ctx context.Context, groupID, uid string, userIDs []string) (int, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return 0, err
	}
	return s.Groups.InviteMembers(ctx, internalID, uid, userIDs)
}

func (s *GroupService) AcceptInvitation(ctx context.Context, uid, token string) (models.GroupInfo, error) {
	return s.Groups.AcceptInvitation(ctx, uid, token)
}

func (s *GroupService) CreateJoinRequest(ctx context.Context, groupID, uid, remark string) (models.GroupJoinRequestItem, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupJoinRequestItem{}, err
	}
	return s.Groups.CreateJoinRequest(ctx, internalID, uid, remark)
}

func (s *GroupService) ListJoinRequests(ctx context.Context, groupID, uid string) ([]models.GroupJoinRequestItem, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return s.Groups.ListJoinRequests(ctx, internalID, uid)
}

func (s *GroupService) ApproveJoinRequest(ctx context.Context, groupID, uid, requestID string) (models.GroupInfo, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	return s.Groups.ApproveJoinRequest(ctx, internalID, uid, requestID)
}

func (s *GroupService) RejectJoinRequest(ctx context.Context, groupID, uid, requestID string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.RejectJoinRequest(ctx, internalID, uid, requestID)
}

func (s *GroupService) RemoveMember(ctx context.Context, groupID, uid, targetID string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.RemoveMember(ctx, internalID, uid, targetID)
}

func (s *GroupService) UpdateMemberRole(ctx context.Context, groupID, operatorID, memberID, role string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.UpdateMemberRole(ctx, internalID, operatorID, memberID, role)
}

func (s *GroupService) UpdateMemberMute(ctx context.Context, groupID, operatorID, memberID string, mutedSeconds int64) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.UpdateMemberMute(ctx, internalID, operatorID, memberID, mutedSeconds)
}

func (s *GroupService) UpdateGroupMute(ctx context.Context, groupID, operatorID string, muted bool) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.UpdateGroupMute(ctx, internalID, operatorID, muted)
}

func (s *GroupService) Dismiss(ctx context.Context, groupID, operatorID string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.Dismiss(ctx, internalID, operatorID)
}
