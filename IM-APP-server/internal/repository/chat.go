package repository

import (
	"context"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ChatRepo struct {
	DB *pgxpool.Pool
}

func (r *ChatRepo) ListConversations(ctx context.Context, uid string) ([]models.Conversation, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT c.id::text, c.type, c.title, c.avatar,
			COALESCE((
				SELECT content FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1
			), ''),
			COALESCE((
				SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1
			), c.created_at),
			cm.unread_count,
			COALESCE((
				SELECT cm2.user_id::text FROM conversation_members cm2
				WHERE cm2.conversation_id=c.id AND cm2.user_id <> $1 AND c.type='private'
				LIMIT 1
			), '')
		FROM conversation_members cm
		JOIN conversations c ON c.id = cm.conversation_id
		WHERE cm.user_id=$1
		ORDER BY 6 DESC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]models.Conversation, 0)
	for rows.Next() {
		var item models.Conversation
		if err := rows.Scan(&item.ID, &item.Type, &item.Title, &item.Avatar,
			&item.LastMessage, &item.LastMessageAt, &item.UnreadCount, &item.PeerUserID); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, nil
}

func (r *ChatRepo) IsMember(ctx context.Context, convID, uid string) (bool, error) {
	var exists bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2)`,
		convID, uid).Scan(&exists)
	return exists, err
}

func (r *ChatRepo) ListMessages(ctx context.Context, convID string) ([]models.Message, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, conversation_id::text, sender_id::text, type, content, created_at
		FROM messages WHERE conversation_id=$1
		ORDER BY created_at ASC LIMIT 200`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Type, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, nil
}

func (r *ChatRepo) MarkConversationRead(ctx context.Context, convID, uid string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE conversation_members SET unread_count=0, last_read_at=NOW()
		WHERE conversation_id=$1 AND user_id=$2`, convID, uid)
	return err
}

func (r *ChatRepo) SendMessage(ctx context.Context, convID, uid, msgType, content string) (models.Message, error) {
	var m models.Message
	err := r.DB.QueryRow(ctx, `
		INSERT INTO messages(conversation_id, sender_id, type, content)
		VALUES($1,$2,$3,$4)
		RETURNING id::text, conversation_id::text, sender_id::text, type, content, created_at`,
		convID, uid, msgType, content,
	).Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Type, &m.Content, &m.CreatedAt)
	if err != nil {
		return m, err
	}
	_, _ = r.DB.Exec(ctx, `
		UPDATE conversation_members SET unread_count = unread_count + 1
		WHERE conversation_id=$1 AND user_id <> $2`, convID, uid)
	_, _ = r.DB.Exec(ctx, `UPDATE conversations SET updated_at=NOW() WHERE id=$1`, convID)
	return m, nil
}

func (r *ChatRepo) ReadAll(ctx context.Context, uid string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE conversation_members SET unread_count=0, last_read_at=NOW() WHERE user_id=$1`, uid)
	return err
}

func (r *ChatRepo) ListConversationMemberIDs(ctx context.Context, convID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT user_id::text FROM conversation_members WHERE conversation_id=$1`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// GetMessage 按 ID 查询单条消息
func (r *ChatRepo) GetMessage(ctx context.Context, messageID string) (models.Message, error) {
	var m models.Message
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, conversation_id::text, sender_id::text, type, content, created_at
		FROM messages WHERE id=$1::uuid`, messageID,
	).Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Type, &m.Content, &m.CreatedAt)
	return m, err
}
