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
	Files  *repository.FileRepo
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

func (s *GroupService) UpdateSettings(ctx context.Context, groupID, uid string, name, avatarFileID, announcement *string, allow *bool, joinMode *string, allMuted *bool) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" || len([]rune(trimmed)) > 100 {
			return repository.ErrInvalidGroupOperation
		}
		name = &trimmed
	}
	if announcement != nil && len([]rune(*announcement)) > 2000 {
		return repository.ErrInvalidGroupOperation
	}
	if joinMode != nil && *joinMode != "open" && *joinMode != "approval" {
		return repository.ErrInvalidGroupOperation
	}
	var avatarURL *string
	if avatarFileID != nil {
		if s.Files == nil || strings.TrimSpace(*avatarFileID) == "" {
			return repository.ErrInvalidGroupOperation
		}
		if _, err := uuid.Parse(*avatarFileID); err != nil {
			return repository.ErrInvalidGroupOperation
		}
		file, err := s.Files.FindReadyAvatarByID(ctx, *avatarFileID, uid)
		if err != nil || file.URL == "" {
			return repository.ErrInvalidGroupOperation
		}
		avatarURL = &file.URL
	}
	return s.Groups.UpdateSettings(ctx, internalID, uid, name, avatarURL, announcement, allow, joinMode, allMuted)
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

func (s *GroupService) JoinByQRCode(ctx context.Context, uid, token, remark string) (models.JoinGroupByQRCodeResult, error) {
	token = strings.TrimSpace(token)
	remark = strings.TrimSpace(remark)
	if token == "" || len([]rune(remark)) > 500 {
		return models.JoinGroupByQRCodeResult{}, repository.ErrInvalidGroupOperation
	}
	return s.Groups.JoinByQRCode(ctx, uid, token, remark)
}

func (s *GroupService) UpdateMyNickname(ctx context.Context, groupID, uid, nickname string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	nickname = strings.TrimSpace(nickname)
	if len([]rune(nickname)) > 32 {
		return repository.ErrInvalidGroupOperation
	}
	return s.Groups.UpdateMyNickname(ctx, internalID, uid, nickname)
}

func (s *GroupService) CreateReport(ctx context.Context, groupID, uid, reason, description string, imageFileIDs []string) (models.GroupReportResult, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupReportResult{}, err
	}
	reason = strings.TrimSpace(reason)
	description = strings.TrimSpace(description)
	validReasons := map[string]bool{
		"spam": true, "fraud": true, "pornography": true,
		"violence": true, "harassment": true, "other": true,
	}
	if !validReasons[reason] || len([]rune(description)) > 1000 || len(imageFileIDs) > 9 {
		return models.GroupReportResult{}, repository.ErrInvalidGroupOperation
	}
	imagePaths := make([]string, 0, len(imageFileIDs))
	seen := make(map[string]struct{}, len(imageFileIDs))
	for i, fileID := range imageFileIDs {
		fileID = strings.TrimSpace(fileID)
		if _, err := uuid.Parse(fileID); err != nil {
			return models.GroupReportResult{}, repository.ErrInvalidGroupOperation
		}
		if _, exists := seen[fileID]; exists {
			return models.GroupReportResult{}, repository.ErrInvalidGroupOperation
		}
		seen[fileID] = struct{}{}
		imageFileIDs[i] = fileID
	}
	if len(imageFileIDs) > 0 {
		if s.Files == nil {
			return models.GroupReportResult{}, repository.ErrInvalidGroupOperation
		}
		imagePaths, err = s.Files.FindReadyReportImagePaths(ctx, imageFileIDs, uid)
		if err != nil {
			return models.GroupReportResult{}, repository.ErrInvalidGroupOperation
		}
	}
	return s.Groups.CreateReport(ctx, internalID, uid, reason, description, imagePaths)
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
	remark = strings.TrimSpace(remark)
	if len([]rune(remark)) > 500 {
		return models.GroupJoinRequestItem{}, repository.ErrInvalidGroupOperation
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

// DismissByAdmin 管理端解散群（运营操作，无 owner 校验；同步 OpenIM）
func (s *GroupService) DismissByAdmin(ctx context.Context, groupID, adminID, reason string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.DismissByAdmin(ctx, internalID, adminID, reason)
}

func (s *GroupService) GetGroupRemark(ctx context.Context, groupID, uid string) (string, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return "", err
	}
	return s.Groups.GetGroupRemark(ctx, uid, internalID)
}

func (s *GroupService) UpdateGroupRemark(ctx context.Context, groupID, uid, remark string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	remark = strings.TrimSpace(remark)
	if len([]rune(remark)) > 64 {
		return repository.ErrInvalidGroupOperation
	}
	return s.Groups.SetGroupRemark(ctx, uid, internalID, remark)
}

func (s *GroupService) GetMemberRemarks(ctx context.Context, groupID, uid string) (map[string]string, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return s.Groups.GetMemberRemarks(ctx, uid, internalID)
}

func (s *GroupService) UpdateMemberRemark(ctx context.Context, groupID, uid, memberUserID, remark string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	if _, err := uuid.Parse(memberUserID); err != nil {
		return repository.ErrInvalidGroupOperation
	}
	remark = strings.TrimSpace(remark)
	if len([]rune(remark)) > 64 {
		return repository.ErrInvalidGroupOperation
	}
	return s.Groups.SetMemberRemark(ctx, uid, internalID, memberUserID, remark)
}
