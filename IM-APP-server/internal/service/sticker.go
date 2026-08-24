package service

import (
	"context"
	"errors"
	"strings"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

const maxStickersPerUser = 200

// StickerService 自定义表情业务
type StickerService struct {
	Stickers *repository.StickerRepo
	Files    *repository.FileRepo
}

// Create 用已上传完成的 sticker/image 文件创建表情
func (s *StickerService) Create(ctx context.Context, uid, fileID string) (models.Sticker, error) {
	fileID = strings.TrimSpace(fileID)
	if fileID == "" {
		return models.Sticker{}, errors.New("fileId 必填")
	}
	if _, err := uuid.Parse(fileID); err != nil {
		return models.Sticker{}, errors.New("fileId 不合法")
	}
	if existing, err := s.Stickers.FindByUserAndFile(ctx, uid, fileID); err == nil {
		return existing, nil
	}
	count, err := s.Stickers.Count(ctx, uid)
	if err != nil {
		return models.Sticker{}, err
	}
	if count >= maxStickersPerUser {
		return models.Sticker{}, errors.New("表情数量已达上限")
	}
	file, err := s.Files.FindReadyStickerByID(ctx, fileID, uid)
	if err != nil {
		return models.Sticker{}, errors.New("表情图片不存在或未上传完成")
	}
	if strings.TrimSpace(file.URL) == "" {
		return models.Sticker{}, errors.New("表情图片地址无效")
	}
	return s.Stickers.Create(ctx, uid, file.ID, file.URL)
}

// List 表情列表
func (s *StickerService) List(ctx context.Context, uid string, page, size int) ([]models.Sticker, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 100
	}
	return s.Stickers.List(ctx, uid, size, (page-1)*size)
}

// Delete 批量删除
func (s *StickerService) Delete(ctx context.Context, uid string, ids []string) error {
	clean := make([]string, 0, len(ids))
	seen := map[string]struct{}{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, err := uuid.Parse(id); err != nil {
			return errors.New("stickerId 不合法")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		clean = append(clean, id)
	}
	if len(clean) == 0 {
		return errors.New("请选择要删除的表情")
	}
	n, err := s.Stickers.DeleteMany(ctx, uid, clean)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
