package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupReadCursorRepo struct{ DB *pgxpool.Pool }

func (r *GroupReadCursorRepo) IsActiveMember(ctx context.Context, groupID, userID string) (bool, error) {
	var ok bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
			WHERE gm.group_id=$1::uuid AND gm.user_id=$2::uuid AND g.status='active'
		)`, groupID, userID).Scan(&ok)
	return ok, err
}

func (r *GroupReadCursorRepo) Upsert(ctx context.Context, conversationID, groupID, userID string, seq int64) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO im_group_read_cursors(conversation_id, group_id, user_id, has_read_seq, updated_at)
		VALUES($1,$2::uuid,$3::uuid,$4,NOW())
		ON CONFLICT(conversation_id,user_id) DO UPDATE
		SET has_read_seq=GREATEST(im_group_read_cursors.has_read_seq,EXCLUDED.has_read_seq), updated_at=NOW()`,
		conversationID, groupID, userID, seq)
	return err
}

func (r *GroupReadCursorRepo) MaxOther(ctx context.Context, conversationID, userID string) (int64, error) {
	var seq int64
	err := r.DB.QueryRow(ctx, `
		SELECT COALESCE(MAX(has_read_seq),0)
		FROM im_group_read_cursors WHERE conversation_id=$1 AND user_id<>$2::uuid`,
		conversationID, userID).Scan(&seq)
	return seq, err
}
