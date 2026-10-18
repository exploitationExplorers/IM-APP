package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"im-app-server/internal/media"
	"im-app-server/internal/models"
)

// FavoriteService 收藏业务
type FavoriteService struct {
	Fav   FavoriteRepository
	Media FavoriteArchiver
	Guard FavoriteGuard
}

type FavoriteRepository interface {
	GetByMessageID(context.Context, string, string) (models.Favorite, error)
	Create(context.Context, string, string, string, string, string, string, bool) (models.Favorite, error)
	Archive(context.Context, string, string, string, string) error
	List(context.Context, string, []string, int, int) ([]models.Favorite, error)
	Delete(context.Context, string, string) error
}
type FavoriteArchiver interface {
	Preserve(context.Context, string, string, string, string) (string, error)
}
type FavoriteGuard interface {
	WithShared(context.Context, func(context.Context) error) error
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
	if len(in.Content) > media.MaxContentBytes {
		return models.Favorite{}, errors.New("收藏内容过长")
	}
	var result models.Favorite
	action := func(ctx context.Context) error {
		existing, err := s.Fav.GetByMessageID(ctx, uid, messageID)
		if err == nil {
			result, err = s.ensureArchived(ctx, uid, existing)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		content := in.Content
		if media.IsMedia(msgType) {
			if s.Media == nil {
				return errors.New("收藏媒体存储未配置")
			}
			content, err = s.Media.Preserve(ctx, uid, messageID, msgType, content)
			if err != nil {
				return err
			}
		}
		result, err = s.Fav.Create(ctx, uid, messageID, msgType, content, strings.TrimSpace(in.SenderID), strings.TrimSpace(in.ConversationID), true)
		// An older writer can win ON CONFLICT with an unarchived snapshot.
		if err == nil {
			result, err = s.ensureArchived(ctx, uid, result)
		}
		return err
	}
	var err error
	if s.Guard != nil {
		err = s.Guard.WithShared(ctx, action)
	} else {
		err = action(ctx)
	}
	return result, err
}

func (s *FavoriteService) ensureArchived(ctx context.Context, uid string, existing models.Favorite) (models.Favorite, error) {
	if !media.IsMedia(existing.Type) || existing.MediaArchived {
		return existing, nil
	}
	if s.Media == nil {
		return models.Favorite{}, errors.New("收藏媒体存储未配置")
	}
	content, err := s.Media.Preserve(ctx, uid, existing.MessageID, existing.Type, existing.Content)
	if err != nil {
		return models.Favorite{}, err
	}
	if err = s.Fav.Archive(ctx, uid, existing.ID, existing.Content, content); err != nil {
		// Another archive request may have committed first. Never return our
		// speculative snapshot if the persisted one differs.
		current, readErr := s.Fav.GetByMessageID(ctx, uid, existing.MessageID)
		if readErr == nil && current.MediaArchived {
			return current, nil
		}
		return models.Favorite{}, err
	}
	existing.Content, existing.MediaArchived = content, true
	return existing, nil
}

// ArchiveExisting compensates legacy media from its persisted snapshot. The
// caller cannot replace the type or source URL while retrying a failed copy.
func (s *FavoriteService) ArchiveExisting(ctx context.Context, uid, messageID string) error {
	action := func(ctx context.Context) error {
		existing, err := s.Fav.GetByMessageID(ctx, uid, messageID)
		if err != nil {
			return err
		}
		_, err = s.ensureArchived(ctx, uid, existing)
		return err
	}
	if s.Guard != nil {
		return s.Guard.WithShared(ctx, action)
	}
	return action(ctx)
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
