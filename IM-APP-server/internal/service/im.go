package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"im-app-server/internal/config"
	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrIMUnavailable     = errors.New("OpenIM service is unavailable")
	ErrIMAccountInactive = errors.New("account is not active")
)

type IMToken struct {
	UserID    string `json:"userId"`
	Token     string `json:"token"`
	Platform  int    `json:"platform"`
	ExpireSec int    `json:"expireSec"`
	APIAddr   string `json:"apiAddr"`
	WSAddr    string `json:"wsAddr"`
}

type IMService struct {
	Client *im.Client
	Users  *repository.UserRepo
	Access *repository.IMAccessRepo
	Config config.OpenIMConfig
}

func (s *IMService) ResolvePeer(ctx context.Context, requesterID, targetID string) (models.IMPeer, error) {
	imUserID, err := im.UserIDFromBusinessID(targetID)
	if err != nil {
		return models.IMPeer{}, err
	}
	peer, err := s.Access.ResolvePeer(ctx, requesterID, targetID)
	if err != nil {
		return peer, err
	}
	peer.IMUserID = imUserID
	return peer, nil
}

func (s *IMService) ResolveGroup(ctx context.Context, userID, groupID string) (models.IMGroupTarget, error) {
	imGroupID, err := im.UserIDFromBusinessID(groupID)
	if err != nil {
		return models.IMGroupTarget{}, err
	}
	group, err := s.Access.ResolveGroup(ctx, userID, groupID)
	if err != nil {
		return group, err
	}
	group.IMGroupID = imGroupID
	return group, nil
}

func (s *IMService) Token(ctx context.Context, userID string, platformID int) (IMToken, error) {
	if s.Client == nil || !s.Client.Available() || s.Config.PublicAPIURL == "" || s.Config.PublicWSURL == "" {
		return IMToken{}, ErrIMUnavailable
	}
	user, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return IMToken{}, ErrIMAccountInactive
		}
		return IMToken{}, err
	}
	if user.Status != "active" {
		return IMToken{}, ErrIMAccountInactive
	}
	openIMUserID, err := im.UserIDFromBusinessID(user.ID)
	if err != nil {
		return IMToken{}, err
	}
	if err := s.Client.EnsureUser(ctx, im.User{
		UserID: openIMUserID, Nickname: user.Nickname, FaceURL: user.Avatar,
	}); err != nil {
		return IMToken{}, err
	}
	token, err := s.Client.GetUserToken(ctx, openIMUserID, platformID)
	if err != nil {
		return IMToken{}, err
	}
	return IMToken{
		UserID: openIMUserID, Token: token.Token, Platform: token.PlatformID,
		ExpireSec: token.ExpireSec, APIAddr: s.Config.PublicAPIURL, WSAddr: s.Config.PublicWSURL,
	}, nil
}
