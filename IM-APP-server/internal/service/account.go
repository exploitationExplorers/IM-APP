package service

import (
	"context"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"im-app-server/internal/models"
)

var ErrAccountPassword = errors.New("登录密码错误；未设置或忘记密码时请先重置密码")

type AccountUsers interface {
	FindByID(context.Context, string) (models.User, error)
}
type AccountRepository interface {
	Cancel(context.Context, string, string) error
	OwnedGroupCount(context.Context, string) (int, error)
}
type AccountService struct {
	Users    AccountUsers
	Accounts AccountRepository
}

func (s *AccountService) Delete(ctx context.Context, userID, password string) error {
	user, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if user.Status != "active" {
		return ErrForbidden
	}
	if password == "" || len(password) > 72 || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return ErrAccountPassword
	}
	return s.Accounts.Cancel(ctx, userID, user.PasswordHash)
}
