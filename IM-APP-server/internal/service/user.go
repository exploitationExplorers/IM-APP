package service

import (
	"context"
	"errors"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrForbidden     = errors.New("forbidden")
	ErrAlreadyFriend = errors.New("already friend")
	ErrSelfAction    = errors.New("cannot act on self")
)

type UserService struct {
	Users *repository.UserRepo
}

func (s *UserService) GetProfile(ctx context.Context, uid string) (models.User, error) {
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return u, ErrNotFound
	}
	return repository.PublicUser(u), nil
}

func (s *UserService) UpdateProfile(ctx context.Context, uid string, nickname, avatar, bio *string) (models.User, error) {
	if nickname != nil && (len(*nickname) < 1 || len(*nickname) > 32) {
		return models.User{}, errors.New("nickname length invalid")
	}
	u, err := s.Users.UpdateProfile(ctx, uid, nickname, avatar, bio)
	if err != nil {
		return u, err
	}
	return repository.PublicUser(u), nil
}

func (s *UserService) SearchByPublicID(ctx context.Context, uid, publicID string) (*models.User, error) {
	u, err := s.Users.FindByPublicID(ctx, publicID)
	if err != nil {
		return nil, nil
	}
	if u.ID == uid {
		return nil, errors.New("cannot search self")
	}
	pub := repository.PublicUser(u)
	return &pub, nil
}

func (s *UserService) GetPublicProfile(ctx context.Context, userID string) (models.User, error) {
	u, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		return u, ErrNotFound
	}
	return repository.PublicUser(u), nil
}

func (s *UserService) Qrcode(ctx context.Context, uid string) (models.QrcodePayload, error) {
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return models.QrcodePayload{}, ErrNotFound
	}
	return s.Users.QrcodePayload(u), nil
}
