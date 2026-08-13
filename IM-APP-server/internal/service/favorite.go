package service

import (
	"context"
	"errors"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

// FavoriteService 收藏业务
type FavoriteService struct {
	Fav  *repository.FavoriteRepo
	Chat *repository.ChatRepo
}

var validFavoriteTypes = map[string]bool{
	"text": true, "emoji": true, "image": true, "video": true, "file": true, "voice": true,
}

// Create 收藏一条消息：校验消息存在、用户是该会话成员、类型支持
func (s *FavoriteService) Create(ctx context.Context, uid, messageID string) (models.Favorite, error) {
	m, err := s.Chat.GetMessage(ctx, messageID)
	if err != nil {
		return models.Favorite{}, errors.New("消息不存在")
	}
	ok, _ := s.Chat.IsMember(ctx, m.ConversationID, uid)
	if !ok {
		return models.Favorite{}, ErrForbidden
	}
	if !validFavoriteTypes[m.Type] {
		return models.Favorite{}, errors.New("不支持收藏该消息类型")
	}
	return s.Fav.Create(ctx, uid, m.ID, m.Type, m.Content, m.SenderID, m.ConversationID)
}

// List 查询收藏，msgType 为空=全部，支持 text/emoji/image/video/file/voice
func (s *FavoriteService) List(ctx context.Context, uid, msgType string, page, size int) ([]models.Favorite, error) {
	if msgType != "" && !validFavoriteTypes[msgType] {
		return nil, errors.New("收藏类型不合法")
	}
	return s.Fav.List(ctx, uid, msgType, size, (page-1)*size)
}

func (s *FavoriteService) Delete(ctx context.Context, uid, favoriteID string) error {
	return s.Fav.Delete(ctx, uid, favoriteID)
}
