package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrInvalidContactQuery  = errors.New("invalid contact query")
	ErrInvalidFriendRequest = errors.New("invalid friend request")
)

type ContactService struct {
	Contacts *repository.ContactRepo
	Groups   *repository.GroupRepo
	Users    *repository.UserRepo
	Tags     *repository.ContactTagRepo
	Privacy  *repository.PrivacyRepo
}

func (s *ContactService) ListContacts(ctx context.Context, uid, keyword, sort, cursor string, limit int) (models.ContactPage, error) {
	keyword = strings.TrimSpace(keyword)
	if utf8.RuneCountInString(keyword) > 64 {
		return models.ContactPage{}, ErrInvalidContactQuery
	}
	if sort != "name" {
		sort = "recent"
	}
	if cursor != "" {
		if _, err := uuid.Parse(cursor); err != nil {
			return models.ContactPage{}, ErrInvalidContactQuery
		}
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.Contacts.ListContacts(ctx, uid, escapeLike(keyword), sort, cursor, limit)
}

func escapeLike(raw string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(raw)
}

func (s *ContactService) ListGroups(ctx context.Context, uid, role string) ([]models.GroupPreview, error) {
	return s.Contacts.ListGroups(ctx, uid, role)
}

func (s *ContactService) ListFriendRequests(ctx context.Context, uid, direction string) ([]models.FriendRequest, error) {
	if direction == "" {
		direction = "received"
	}
	return s.Contacts.ListFriendRequests(ctx, uid, direction)
}

func (s *ContactService) SendFriendRequest(ctx context.Context, uid, toUserID, message, source, sourceGroupID string) (models.SendFriendResult, error) {
	empty := models.SendFriendResult{}
	toUserID = strings.TrimSpace(toUserID)
	message = strings.TrimSpace(message)
	source = strings.TrimSpace(source)
	sourceGroupID = strings.TrimSpace(sourceGroupID)
	parsedTargetID, err := uuid.Parse(toUserID)
	if err != nil || utf8.RuneCountInString(message) > 500 {
		return empty, ErrInvalidFriendRequest
	}
	toUserID = parsedTargetID.String()
	if source == "" {
		source = "public_id"
	}
	if source != "public_id" && source != "user_qrcode" && source != "group" {
		return empty, ErrInvalidFriendRequest
	}
	if source == "group" && sourceGroupID == "" {
		return empty, ErrInvalidFriendRequest
	}
	if source != "group" && sourceGroupID != "" {
		return empty, ErrInvalidFriendRequest
	}
	if uid == toUserID {
		return empty, ErrSelfAction
	}
	if _, err := s.Users.FindByID(ctx, toUserID); err != nil {
		return empty, ErrNotFound
	}
	blocked, _ := s.Contacts.IsBlocked(ctx, toUserID, uid)
	if blocked {
		return empty, ErrForbidden
	}
	ok, _ := s.Contacts.IsFriend(ctx, uid, toUserID)
	if ok {
		return empty, ErrAlreadyFriend
	}
	if source == "group" {
		internalID, err := s.Groups.InternalIDByPublicID(ctx, sourceGroupID)
		if err != nil {
			if errors.Is(err, repository.ErrGroupNotFound) {
				return empty, ErrNotFound
			}
			return empty, ErrForbidden
		}
		allowed, err := s.Contacts.IsGroupAddFriendAllowed(ctx, uid, toUserID, internalID)
		if err != nil || !allowed {
			return empty, ErrForbidden
		}
		sourceGroupID = internalID
	}

	// 对方未开启「加我为好友需验证」时直接成为好友（参考站默认关闭）
	needApproval := true
	if s.Privacy != nil {
		ps, err := s.Privacy.Get(ctx, toUserID)
		if err == nil {
			needApproval = ps.RequireFriendApproval
		}
	}
	if !needApproval {
		id, err := s.Contacts.AddFriendDirect(ctx, uid, toUserID, message, source, sourceGroupID)
		if err != nil {
			return empty, err
		}
		return models.SendFriendResult{OK: true, ID: id, Status: "accepted"}, nil
	}

	id, err := s.Contacts.CreateFriendRequest(ctx, uid, toUserID, message, source, sourceGroupID)
	if err != nil {
		return empty, err
	}
	return models.SendFriendResult{OK: true, ID: id, Status: "pending"}, nil
}

func (s *ContactService) SendGroupFriendRequest(ctx context.Context, uid string, req models.CreateGroupFriendRequest) (models.GroupFriendRequestResult, error) {
	result, err := s.SendFriendRequest(ctx, uid, req.ToUserID, req.Message, "group", req.GroupID)
	if err != nil {
		return models.GroupFriendRequestResult{}, err
	}
	return models.GroupFriendRequestResult{
		OK: result.OK, RequestID: result.ID, Status: result.Status,
	}, nil
}

func (s *ContactService) AcceptFriendRequest(ctx context.Context, uid, requestID string) error {
	return s.Contacts.AcceptFriendRequest(ctx, requestID, uid)
}

func (s *ContactService) RejectFriendRequest(ctx context.Context, uid, requestID string) error {
	return s.Contacts.RejectFriendRequest(ctx, requestID, uid)
}

func (s *ContactService) DeleteContact(ctx context.Context, uid, contactID string) error {
	return s.Contacts.DeleteFriend(ctx, uid, contactID)
}

func (s *ContactService) BlockContact(ctx context.Context, uid, contactID string) error {
	return s.Contacts.BlockUser(ctx, uid, contactID)
}

func (s *ContactService) UnblockContact(ctx context.Context, uid, contactID string) error {
	return s.Contacts.UnblockUser(ctx, uid, contactID)
}

// ListBlockedContacts 返回当前用户的黑名单列表
func (s *ContactService) ListBlockedContacts(ctx context.Context, uid, keyword string, limit int) (models.BlockedListResponse, error) {
	items, total, err := s.Contacts.ListBlockedUsers(ctx, uid, keyword, limit)
	if err != nil {
		return models.BlockedListResponse{}, err
	}
	return models.BlockedListResponse{Items: items, Total: total}, nil
}

func (s *ContactService) GetConversationID(ctx context.Context, uid, contactID string) (string, error) {
	ok, _ := s.Contacts.IsFriend(ctx, uid, contactID)
	if !ok {
		return "", ErrForbidden
	}
	return s.Contacts.GetOrCreatePrivateConversation(ctx, uid, contactID)
}

func (s *ContactService) GetContact(ctx context.Context, uid, contactID string) (models.Contact, error) {
	c, err := s.Contacts.GetContact(ctx, uid, contactID)
	if err != nil {
		return c, ErrNotFound
	}
	if s.Tags != nil {
		tags, err := s.Tags.ListByFriend(ctx, uid, contactID)
		if err != nil {
			return c, err
		}
		c.Tags = tags
	} else {
		c.Tags = []models.ContactTagItem{}
	}
	groups, err := s.Contacts.ListCommonGroups(ctx, uid, contactID)
	if err != nil {
		return c, err
	}
	c.CommonGroups = groups
	return c, nil
}

func (s *ContactService) UpdateContact(ctx context.Context, uid, contactID string, remark *string, tagIDs []string) (models.Contact, error) {
	if remark != nil {
		if err := s.Contacts.UpdateContactRemark(ctx, uid, contactID, *remark); err != nil {
			return models.Contact{}, ErrNotFound
		}
	}
	if tagIDs != nil {
		if s.Tags == nil {
			return models.Contact{}, errors.New("标签功能不可用")
		}
		if err := s.Tags.SetFriendTags(ctx, uid, contactID, tagIDs); err != nil {
			return models.Contact{}, ErrNotFound
		}
	}
	return s.GetContact(ctx, uid, contactID)
}

func (s *ContactService) ListTags(ctx context.Context, uid string) ([]models.ContactTagItem, error) {
	if s.Tags == nil {
		return []models.ContactTagItem{}, nil
	}
	return s.Tags.List(ctx, uid)
}

func (s *ContactService) CreateTag(ctx context.Context, uid, name string) (models.ContactTagItem, error) {
	if name == "" {
		return models.ContactTagItem{}, errors.New("标签名不能为空")
	}
	return s.Tags.Create(ctx, uid, name)
}

func (s *ContactService) UpdateTag(ctx context.Context, uid, tagID, name string) (models.ContactTagItem, error) {
	if name == "" {
		return models.ContactTagItem{}, errors.New("标签名不能为空")
	}
	item, err := s.Tags.Update(ctx, uid, tagID, name)
	if err != nil {
		return item, ErrNotFound
	}
	return item, nil
}

func (s *ContactService) DeleteTag(ctx context.Context, uid, tagID string) error {
	if err := s.Tags.Delete(ctx, uid, tagID); err != nil {
		return ErrNotFound
	}
	return nil
}

func (s *ContactService) SetTagMembers(ctx context.Context, uid, tagID string, userIDs []string) (models.ContactTagItem, error) {
	item, err := s.Tags.SetMembers(ctx, uid, tagID, userIDs)
	if err != nil {
		return item, ErrNotFound
	}
	return item, nil
}

func (s *ContactService) ListTagMembers(ctx context.Context, uid, tagID string) ([]models.Contact, error) {
	return s.Tags.ListMembers(ctx, uid, tagID)
}
