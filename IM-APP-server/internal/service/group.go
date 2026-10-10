package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

type GroupService struct {
	Groups *repository.GroupRepo
	Files  *repository.FileRepo
	Users  *repository.UserRepo
	IM     *im.Client
}

// 群号：qun_ + 6–20 位字母数字（系统分配为 qun_ + 14 位小写随机）。遗留纯数字群号仍可查。
var groupPublicIDPattern = regexp.MustCompile(`^qun_[A-Za-z0-9]{6,20}$`)

func isLegacyNumericGroupID(id string) bool {
	if id == "" {
		return false
	}
	for _, r := range id {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isValidGroupPublicID(id string) bool {
	return isLegacyNumericGroupID(id) || groupPublicIDPattern.MatchString(id)
}

// NormalizeGroupPublicID 校验用户自定义群号，大小写原样返回。
func NormalizeGroupPublicID(raw string) (string, bool) {
	id := strings.TrimSpace(raw)
	return id, groupPublicIDPattern.MatchString(id)
}

func (s *GroupService) internalGroupID(ctx context.Context, publicID string) (string, error) {
	publicID = strings.TrimSpace(publicID)
	if !isValidGroupPublicID(publicID) {
		return "", repository.ErrInvalidGroupOperation
	}
	return s.Groups.InternalIDByPublicID(ctx, publicID)
}

// UpdatePublicID 群主把系统分配的群号改成自定义 qun_xxx，每个群只能改一次。
func (s *GroupService) UpdatePublicID(ctx context.Context, uid, groupPublicID, raw string) (models.GroupInfo, error) {
	internalID, err := s.internalGroupID(ctx, groupPublicID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	detail, err := s.Groups.GetByID(ctx, internalID, uid)
	if err != nil {
		return models.GroupInfo{}, err
	}
	if detail.MyRole != "owner" {
		return models.GroupInfo{}, repository.ErrForbidden
	}
	newID, ok := NormalizeGroupPublicID(raw)
	if !ok {
		return models.GroupInfo{}, errors.New("群号需为 qun_ 开头，后接 6-20 位字母或数字")
	}
	used, err := s.Groups.GroupPublicIDChangeUsed(ctx, internalID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	if used {
		return models.GroupInfo{}, errors.New("群号只能修改一次")
	}
	taken, err := s.Groups.GroupPublicIDTaken(ctx, newID, internalID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	if taken {
		return models.GroupInfo{}, errors.New("该群号已被使用")
	}
	if err := s.Groups.UpdateGroupPublicID(ctx, internalID, newID); err != nil {
		switch {
		case errors.Is(err, repository.ErrPublicIDChangeUsed):
			return models.GroupInfo{}, errors.New("群号只能修改一次")
		case errors.Is(err, repository.ErrPublicIDTaken):
			return models.GroupInfo{}, errors.New("该群号已被使用")
		}
		return models.GroupInfo{}, err
	}
	return s.Groups.GetByID(ctx, internalID, uid)
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

func (s *GroupService) GetDissolvedInfo(ctx context.Context, groupID string) (models.DissolvedGroupInfo, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.DissolvedGroupInfo{}, err
	}
	return s.Groups.GetDissolvedInfo(ctx, internalID)
}

func (s *GroupService) RemoveDissolvedGroup(ctx context.Context, groupID, uid string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.RemoveDissolvedMembership(ctx, internalID, uid)
}

func (s *GroupService) ListMembers(ctx context.Context, groupID, uid, cursor string, limit int) (models.GroupMemberPage, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupMemberPage{}, err
	}
	return s.Groups.ListMembers(ctx, internalID, uid, cursor, limit)
}

func (s *GroupService) Join(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	return s.Groups.Join(ctx, internalID, uid)
}

func (s *GroupService) UpdateSettings(
	ctx context.Context,
	groupID, uid string,
	name, avatarFileID, announcement *string,
	announcementImageFileIDs, keepAnnouncementImages *[]string,
	allow *bool, joinMode *string, allMuted *bool,
) error {
	if name == nil && avatarFileID == nil && announcement == nil && allow == nil && joinMode == nil && allMuted == nil {
		return repository.ErrInvalidGroupOperation
	}
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

	var announcementImages *[]string
	if announcement != nil {
		images, err := s.resolveAnnouncementImages(ctx, internalID, uid, announcementImageFileIDs, keepAnnouncementImages)
		if err != nil {
			return err
		}
		announcementImages = &images
	}
	return s.Groups.UpdateSettings(ctx, internalID, uid, name, avatarURL, announcement, announcementImages, allow, joinMode, allMuted)
}

const maxAnnouncementImages = 9

/** 合并保留 URL + 新上传 fileId，上限 9；非法引用直接拒绝 */
func (s *GroupService) resolveAnnouncementImages(
	ctx context.Context,
	groupID, uid string,
	fileIDs, keepURLs *[]string,
) ([]string, error) {
	keep := []string{}
	if keepURLs != nil {
		keep = *keepURLs
	}
	ids := []string{}
	if fileIDs != nil {
		ids = *fileIDs
	}
	if len(keep)+len(ids) > maxAnnouncementImages {
		return nil, repository.ErrInvalidGroupOperation
	}

	current, err := s.Groups.AnnouncementImagesOf(ctx, groupID)
	if err != nil {
		return nil, err
	}
	allowed := map[string]struct{}{}
	for _, u := range current {
		if u != "" {
			allowed[u] = struct{}{}
		}
	}

	out := make([]string, 0, len(keep)+len(ids))
	seen := map[string]struct{}{}
	for _, raw := range keep {
		u := strings.TrimSpace(raw)
		if u == "" {
			continue
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			return nil, repository.ErrInvalidGroupOperation
		}
		if _, ok := allowed[u]; !ok {
			return nil, repository.ErrInvalidGroupOperation
		}
		if _, dup := seen[u]; dup {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	if len(ids) > 0 {
		if s.Files == nil {
			return nil, repository.ErrInvalidGroupOperation
		}
		for _, id := range ids {
			if _, err := uuid.Parse(strings.TrimSpace(id)); err != nil {
				return nil, repository.ErrInvalidGroupOperation
			}
		}
		paths, err := s.Files.FindReadyReportImagePaths(ctx, ids, uid)
		if err != nil {
			return nil, repository.ErrInvalidGroupOperation
		}
		for _, u := range paths {
			if u == "" {
				continue
			}
			if _, dup := seen[u]; dup {
				continue
			}
			seen[u] = struct{}{}
			out = append(out, u)
		}
	}
	if len(out) > maxAnnouncementImages {
		return nil, repository.ErrInvalidGroupOperation
	}
	return out, nil
}

func (s *GroupService) ListAnnouncementHistory(ctx context.Context, groupID, uid string) ([]models.GroupAnnouncementHistoryItem, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return s.Groups.ListAnnouncementHistory(ctx, internalID, uid)
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

func (s *GroupService) InviteMembers(ctx context.Context, groupID, uid string, userIDs []string) (models.InviteGroupMembersResult, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return models.InviteGroupMembersResult{}, err
	}
	result, pending, err := s.Groups.InviteMembers(ctx, internalID, uid, userIDs)
	if err != nil {
		return models.InviteGroupMembersResult{}, err
	}
	cardFailed := 0
	for _, card := range pending {
		if sendErr := s.sendGroupInviteCard(ctx, uid, card); sendErr != nil {
			cardFailed++
			log.Printf("send group invite card failed inviter=%s invitee=%s: %v", uid, card.InviteeID, sendErr)
		}
	}
	result.CardFailedCount = cardFailed
	if cardFailed > 0 && result.PendingCount > 0 {
		result.PendingCount -= cardFailed
	}
	return result, nil
}

func (s *GroupService) sendGroupInviteCard(ctx context.Context, inviterID string, card repository.PendingGroupInviteCard) error {
	if s.IM == nil || !s.IM.Available() {
		return errors.New("openim unavailable")
	}
	sendID, err := im.UserIDFromBusinessID(inviterID)
	if err != nil {
		return err
	}
	recvID, err := im.UserIDFromBusinessID(card.InviteeID)
	if err != nil {
		return err
	}
	if s.Users != nil {
		inviter, err := s.Users.FindByID(ctx, inviterID)
		if err != nil {
			return err
		}
		if err := s.IM.EnsureUser(ctx, im.User{
			UserID: sendID, Nickname: inviter.Nickname, FaceURL: inviter.Avatar,
		}); err != nil {
			return err
		}
		invitee, err := s.Users.FindByID(ctx, card.InviteeID)
		if err != nil {
			return err
		}
		if err := s.IM.EnsureUser(ctx, im.User{
			UserID: recvID, Nickname: invitee.Nickname, FaceURL: invitee.Avatar,
		}); err != nil {
			return err
		}
	}
	payload, err := json.Marshal(map[string]any{
		"businessKey": "group_invite",
		"token":       card.Token,
		"groupId":     card.PublicGroupID,
		"groupName":   card.GroupName,
		"groupAvatar": card.GroupAvatar,
		"memberCount": card.MemberCount,
	})
	if err != nil {
		return err
	}
	clientMsgID := fmt.Sprintf("gi_%s", card.Token)
	if len(clientMsgID) > 64 {
		clientMsgID = clientMsgID[:64]
	}
	_, err = s.IM.SendCustomC2CMessage(ctx, sendID, recvID, clientMsgID, string(payload), "邀请你加入群聊", "group_invite")
	return err
}

func (s *GroupService) AcceptInvitation(ctx context.Context, uid, token string) (models.ApplyGroupInvitationResult, error) {
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

// RemoveMember 移出群成员。purgeMessages 为 true 时同时记录消息清理水位，
// 让群内所有客户端隐藏该成员的历史消息（原来只在前端本地删，只有操作者看得到效果）。
func (s *GroupService) RemoveMember(ctx context.Context, groupID, uid, targetID string, purgeMessages bool) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.RemoveMember(ctx, internalID, uid, targetID, purgeMessages)
}

// MessagePurges 返回群内被「移除并删除消息」清理过的成员列表。
func (s *GroupService) MessagePurges(ctx context.Context, groupID, uid string) ([]models.GroupMessagePurge, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return s.Groups.MessagePurges(ctx, internalID, uid)
}

func (s *GroupService) UpdateMemberRole(ctx context.Context, groupID, operatorID, memberID, role string) error {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return err
	}
	return s.Groups.UpdateMemberRole(ctx, internalID, operatorID, memberID, role)
}

func (s *GroupService) UpdateMemberMute(ctx context.Context, groupID, operatorID, memberID string, mutedSeconds int64) (*time.Time, error) {
	internalID, err := s.internalGroupID(ctx, groupID)
	if err != nil {
		return nil, err
	}
	parsedMemberID, err := uuid.Parse(memberID)
	if err != nil {
		return nil, repository.ErrInvalidGroupOperation
	}
	memberID = parsedMemberID.String()
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
