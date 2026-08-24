package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type StickerRepo struct{ DB *pgxpool.Pool }

// FindByUserAndFile 同一用户同一文件是否已添加
func (r *StickerRepo) FindByUserAndFile(ctx context.Context, userID, fileID string) (models.Sticker, error) {
	var s models.Sticker
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, COALESCE(file_id::text,''), url, created_at
		FROM user_stickers
		WHERE user_id=$1::uuid AND file_id=$2::uuid`,
		userID, fileID,
	).Scan(&s.ID, &s.FileID, &s.URL, &s.CreatedAt)
	return s, err
}

// Create 新增表情；同一用户同一 file_id 幂等返回已有记录
func (r *StickerRepo) Create(ctx context.Context, userID, fileID, url string) (models.Sticker, error) {
	var s models.Sticker
	err := r.DB.QueryRow(ctx, `
		INSERT INTO user_stickers(user_id, file_id, url)
		VALUES($1::uuid, NULLIF($2,'')::uuid, $3)
		ON CONFLICT (user_id, file_id) WHERE file_id IS NOT NULL DO NOTHING
		RETURNING id::text, COALESCE(file_id::text,''), url, created_at`,
		userID, fileID, url,
	).Scan(&s.ID, &s.FileID, &s.URL, &s.CreatedAt)
	if err == nil {
		return s, nil
	}
	if errors.Is(err, pgx.ErrNoRows) && fileID != "" {
		return r.FindByUserAndFile(ctx, userID, fileID)
	}
	return s, err
}

// List 按创建时间倒序；limit/offset 分页
func (r *StickerRepo) List(ctx context.Context, userID string, limit, offset int) ([]models.Sticker, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, COALESCE(file_id::text,''), url, created_at
		FROM user_stickers
		WHERE user_id=$1::uuid
		ORDER BY created_at DESC
		LIMIT $2::int OFFSET $3::int`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Sticker, 0)
	for rows.Next() {
		var s models.Sticker
		if err := rows.Scan(&s.ID, &s.FileID, &s.URL, &s.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	return list, nil
}

// Count 当前用户表情数量
func (r *StickerRepo) Count(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM user_stickers WHERE user_id=$1::uuid`, userID).Scan(&n)
	return n, err
}

// DeleteMany 批量删除本人表情；返回实际删除条数
func (r *StickerRepo) DeleteMany(ctx context.Context, userID string, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tag, err := r.DB.Exec(ctx, `
		DELETE FROM user_stickers
		WHERE user_id=$1::uuid AND id::text = ANY($2::text[])`,
		userID, ids,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
