package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FavoriteRepo struct{ DB *pgxpool.Pool }

// Create 收藏消息；已收藏则返回已有记录（幂等）
func (r *FavoriteRepo) Create(ctx context.Context, userID, messageID, msgType, content, senderID, convID string) (models.Favorite, error) {
	var f models.Favorite
	err := r.DB.QueryRow(ctx, `
		INSERT INTO favorites(user_id, message_id, msg_type, content, sender_id, conversation_id)
		VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid)
		ON CONFLICT (user_id, message_id) DO NOTHING
		RETURNING id::text, message_id::text, msg_type, content,
			COALESCE(sender_id::text,''), conversation_id::text, created_at`,
		userID, messageID, msgType, content, senderID, convID,
	).Scan(&f.ID, &f.MessageID, &f.Type, &f.Content, &f.SenderID, &f.ConversationID, &f.CreatedAt)
	if err == nil {
		return f, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// 已收藏，返回现有记录
		err = r.DB.QueryRow(ctx, `
			SELECT id::text, message_id::text, msg_type, content,
				COALESCE(sender_id::text,''), conversation_id::text, created_at
			FROM favorites WHERE user_id=$1::uuid AND message_id=$2::uuid`, userID, messageID,
		).Scan(&f.ID, &f.MessageID, &f.Type, &f.Content, &f.SenderID, &f.ConversationID, &f.CreatedAt)
		return f, err
	}
	return f, err
}

// List 查询收藏（msgType 为空=全部类型）
func (r *FavoriteRepo) List(ctx context.Context, userID, msgType string, limit, offset int) ([]models.Favorite, error) {
	q := `SELECT id::text, message_id::text, msg_type, content,
			COALESCE(sender_id::text,''), conversation_id::text, created_at
	      FROM favorites WHERE user_id=$1`
	args := []any{userID, limit, offset}
	if msgType != "" {
		q += ` AND msg_type=$2`
		args = []any{userID, msgType, limit, offset}
	}
	q += ` ORDER BY created_at DESC LIMIT $3 OFFSET $4`
	rows, err := r.DB.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Favorite, 0)
	for rows.Next() {
		var f models.Favorite
		if err := rows.Scan(&f.ID, &f.MessageID, &f.Type, &f.Content, &f.SenderID, &f.ConversationID, &f.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	return list, nil
}

// Delete 取消收藏（仅本人可删）
func (r *FavoriteRepo) Delete(ctx context.Context, userID, favoriteID string) error {
	tag, err := r.DB.Exec(ctx, `DELETE FROM favorites WHERE id=$1::uuid AND user_id=$2::uuid`, favoriteID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
