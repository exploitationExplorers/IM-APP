package service

import (
	"context"
	"errors"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

type ContactService struct {
	Contacts *repository.ContactRepo
	Users    *repository.UserRepo
	Tags     *repository.ContactTagRepo
}

func (s *ContactService) ListContacts(ctx context.Context, uid string) ([]models.Contact, error) {
	return s.Contacts.ListContacts(ctx, uid)
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

func (s *ContactService) SendFriendRequest(ctx context.Context, uid, toUserID, message, source, sourceGroupID string) (string, error) {
	if uid == toUserID {
		return "", ErrSelfAction
	}
	if _, err := s.Users.FindByID(ctx, toUserID); err != nil {
		return "", ErrNotFound
	}
	blocked, _ := s.Contacts.IsBlocked(ctx, toUserID, uid)
	if blocked {
		return "", ErrForbidden
	}
	ok, _ := s.Contacts.IsFriend(ctx, uid, toUserID)
	if ok {
		return "", ErrAlreadyFriend
	}
	if source == "" {
		source = "public_id"
	}
	if source == "group" && sourceGroupID != "" {
		allowed, err := s.Contacts.IsGroupAddFriendAllowed(ctx, uid, toUserID, sourceGroupID)
		if err != nil || !allowed {
			return "", ErrForbidden
		}
	}
	return s.Contacts.CreateFriendRequest(ctx, uid, toUserID, message, source, sourceGroupID)
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
	return c, nil
}

func (s *ContactService) UpdateContact(ctx context.Context, uid, contactID string, remark *string) (models.Contact, error) {
	if remark != nil {
		if err := s.Contacts.UpdateContactRemark(ctx, uid, contactID, *remark); err != nil {
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
