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

// List 查询收藏，type：0全部 1文字(含表情) 2图片与视频 3文件 4语音
func (s *FavoriteService) List(ctx context.Context, uid string, typ, page, size int) ([]models.Favorite, error) {
	if typ < 0 || typ > 4 {
		return nil, errors.New("收藏类型不合法")
	}
	return s.Fav.List(ctx, uid, favoriteTypeFilter(typ), size, (page-1)*size)
}

// favoriteTypeFilter 把 type 枚举映射为消息类型集合
func favoriteTypeFilter(typ int) []string {
	switch typ {
	case 1:
		return []string{"text", "emoji"}
	case 2:
		return []string{"image", "video"}
	case 3:
		return []string{"file"}
	case 4:
		return []string{"voice"}
	default:
		return nil // 0=全部
	}
}

func (s *FavoriteService) Delete(ctx context.Context, uid, favoriteID string) error {
	return s.Fav.Delete(ctx, uid, favoriteID)
}
