package service

import (
	"context"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

type ContactService struct {
	Contacts *repository.ContactRepo
	Users    *repository.UserRepo
}

func (s *ContactService) ListContacts(ctx context.Context, uid string) ([]models.Contact, error) {
	return s.Contacts.ListContacts(ctx, uid)
}

func (s *ContactService) ListGroups(ctx context.Context, uid string) ([]models.GroupPreview, error) {
	return s.Contacts.ListGroups(ctx, uid)
}

func (s *ContactService) ListFriendRequests(ctx context.Context, uid string) ([]models.FriendRequest, error) {
	return s.Contacts.ListFriendRequests(ctx, uid)
}

func (s *ContactService) SendFriendRequest(ctx context.Context, uid, toUserID, message string) (string, error) {
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
	return s.Contacts.CreateFriendRequest(ctx, uid, toUserID, message)
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
