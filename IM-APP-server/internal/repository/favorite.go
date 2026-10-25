package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FavoriteRepo struct{ DB *pgxpool.Pool }

// Create 收藏消息快照；已收藏则返回已有记录（幂等）
func (r *FavoriteRepo) Create(ctx context.Context, userID, messageID, msgType, content, senderID, convID string, archived bool) (models.Favorite, error) {
	var f models.Favorite
	err := mediaQueries(ctx, r.DB).QueryRow(ctx, `
		INSERT INTO favorites(user_id, message_id, msg_type, content, sender_id, conversation_id, media_archived)
		VALUES($1::uuid,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7)
		ON CONFLICT (user_id, message_id) DO NOTHING
		RETURNING id::text, message_id, msg_type, content,
			COALESCE(sender_id,''), COALESCE(conversation_id,''), created_at, media_archived`,
		userID, messageID, msgType, content, senderID, convID, archived,
	).Scan(&f.ID, &f.MessageID, &f.Type, &f.Content, &f.SenderID, &f.ConversationID, &f.CreatedAt, &f.MediaArchived)
	if err == nil {
		return f, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		err = mediaQueries(ctx, r.DB).QueryRow(ctx, `
			SELECT id::text, message_id, msg_type, content,
				COALESCE(sender_id,''), COALESCE(conversation_id,''), created_at, media_archived
			FROM favorites WHERE user_id=$1::uuid AND message_id=$2`, userID, messageID,
		).Scan(&f.ID, &f.MessageID, &f.Type, &f.Content, &f.SenderID, &f.ConversationID, &f.CreatedAt, &f.MediaArchived)
		return f, err
	}
	return f, err
}

func (r *FavoriteRepo) GetByMessageID(ctx context.Context, userID, messageID string) (models.Favorite, error) {
	var f models.Favorite
	err := mediaQueries(ctx, r.DB).QueryRow(ctx, `SELECT id::text, message_id, msg_type, content,
		COALESCE(sender_id,''), COALESCE(conversation_id,''), created_at, media_archived
		FROM favorites WHERE user_id=$1::uuid AND message_id=$2`, userID, messageID).Scan(
		&f.ID, &f.MessageID, &f.Type, &f.Content, &f.SenderID, &f.ConversationID, &f.CreatedAt, &f.MediaArchived)
	return f, err
}

func (r *FavoriteRepo) Archive(ctx context.Context, userID, id, previous, content string) error {
	tag, err := mediaQueries(ctx, r.DB).Exec(ctx, `UPDATE favorites SET content=$4, media_archived=true
		WHERE user_id=$1::uuid AND id=$2::uuid AND content=$3 AND NOT media_archived`, userID, id, previous, content)
	if err == nil && tag.RowsAffected() != 1 {
		return errors.New("favorite changed during archiving")
	}
	return err
}

type PendingFavorite struct {
	UserID   string
	Favorite models.Favorite
}

func (r *FavoriteRepo) PendingMedia(ctx context.Context, afterID string, limit int) ([]PendingFavorite, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("archive batch size must be between 1 and 100")
	}
	rows, err := r.DB.Query(ctx, `SELECT user_id::text,id::text,message_id,msg_type,content
		FROM favorites WHERE NOT media_archived AND msg_type IN ('image','voice','video','file')
		AND ($1 = '' OR id > NULLIF($1,'')::uuid)
		ORDER BY id LIMIT $2`, afterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingFavorite
	for rows.Next() {
		var p PendingFavorite
		if err := rows.Scan(&p.UserID, &p.Favorite.ID, &p.Favorite.MessageID, &p.Favorite.Type, &p.Favorite.Content); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// List 查询收藏；types 为空=全部类型，否则按类型集合过滤
func (r *FavoriteRepo) List(ctx context.Context, userID string, types []string, limit, offset int) ([]models.Favorite, error) {
	base := `SELECT id::text, message_id, msg_type, content,
			COALESCE(sender_id,''), COALESCE(conversation_id,''), created_at
	      FROM favorites WHERE user_id=$1::uuid`
	var q string
	var args []any
	if len(types) == 0 {
		q = base + ` ORDER BY created_at DESC LIMIT $2::int OFFSET $3::int`
		args = []any{userID, limit, offset}
	} else {
		q = base + ` AND msg_type = ANY($2) ORDER BY created_at DESC LIMIT $3::int OFFSET $4::int`
		args = []any{userID, types, limit, offset}
	}
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
