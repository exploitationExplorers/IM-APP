package service

import (
	"context"
	"errors"
	"strings"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

// FavoriteService 收藏业务
type FavoriteService struct {
	Fav *repository.FavoriteRepo
}

var validFavoriteTypes = map[string]bool{
	"text": true, "emoji": true, "image": true, "video": true, "file": true, "voice": true,
}

// Create 收藏一条消息快照；同一用户对同一消息幂等
func (s *FavoriteService) Create(ctx context.Context, uid string, in models.CreateFavoriteRequest) (models.Favorite, error) {
	messageID := strings.TrimSpace(in.MessageID)
	msgType := strings.TrimSpace(in.Type)
	if messageID == "" || msgType == "" {
		return models.Favorite{}, errors.New("参数错误")
	}
	if !validFavoriteTypes[msgType] {
		return models.Favorite{}, errors.New("不支持收藏该消息类型")
	}
	if len(in.Content) > 16*1024 {
		return models.Favorite{}, errors.New("收藏内容过长")
	}
	return s.Fav.Create(ctx, uid, messageID, msgType, in.Content, strings.TrimSpace(in.SenderID), strings.TrimSpace(in.ConversationID))
}

// List 查询收藏，type：0全部 1文字(含表情) 2图片与视频 3文件 4语音
func (s *FavoriteService) List(ctx context.Context, uid string, typ, page, size int) ([]models.Favorite, error) {
	if typ < 0 || typ > 4 {
		return nil, errors.New("收藏类型不合法")
	}
	return s.Fav.List(ctx, uid, favoriteTypeFilter(typ), size, (page-1)*size)
}

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
		return nil
	}
}

func (s *FavoriteService) Delete(ctx context.Context, uid, favoriteID string) error {
	return s.Fav.Delete(ctx, uid, favoriteID)
}
