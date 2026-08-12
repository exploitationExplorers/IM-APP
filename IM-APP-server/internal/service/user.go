package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

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
	Files *repository.FileRepo
}

func (s *UserService) GetProfile(ctx context.Context, uid string) (models.User, error) {
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return u, ErrNotFound
	}
	return repository.PublicUser(u), nil
}

// UpdateProfile 部分更新：传了哪个字段就更新哪个；avatarFileID 解析为头像 URL
func (s *UserService) UpdateProfile(ctx context.Context, uid string, nickname, avatarFileID, bio *string) (models.User, error) {
	if nickname != nil && (len(*nickname) < 1 || len(*nickname) > 32) {
		return models.User{}, errors.New("nickname length invalid")
	}
	var avatarURL *string
	if avatarFileID != nil && *avatarFileID != "" {
		f, err := s.Files.FindByID(ctx, *avatarFileID)
		if err != nil {
			return models.User{}, errors.New("头像文件不存在")
		}
		if f.URL != "" {
			avatarURL = &f.URL
		}
	}
	u, err := s.Users.UpdateProfile(ctx, uid, nickname, avatarURL, bio)
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

func (s *UserService) Qrcode(ctx context.Context, uid string) (models.UserQRCodeResult, error) {
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return models.UserQRCodeResult{}, ErrNotFound
	}
	// 返回该用户唯一二维码（无则生成）
	qr, err := s.Users.EnsureQRCode(ctx, uid)
	if err != nil {
		return models.UserQRCodeResult{}, err
	}
	payload, _ := json.Marshal(map[string]string{
		"type":  "user",
		"token": qr.Token,
	})
	return models.UserQRCodeResult{
		Payload:   string(payload),
		ExpiresAt: qr.ExpiresAt.UTC().Format(time.RFC3339),
		User: models.UserSummary{
			ID:       u.ID,
			PublicID: u.PublicID,
			Nickname: u.Nickname,
			Avatar:   u.Avatar,
		},
	}, nil
}
