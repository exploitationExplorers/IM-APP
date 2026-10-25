package repository

import (
	"context"
	"encoding/json"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ForwardMediaRepo struct{ DB *pgxpool.Pool }

func (r *ForwardMediaRepo) Get(ctx context.Context, uid, hash string) (models.ForwardMessageSnapshot, error) {
	var raw []byte
	err := mediaQueries(ctx, r.DB).QueryRow(ctx,
		`SELECT snapshot FROM forward_media_snapshots WHERE user_id=$1::uuid AND source_hash=$2`, uid, hash).Scan(&raw)
	var out models.ForwardMessageSnapshot
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	return out, err
}

// Save returns the persisted winner, never a speculative concurrent copy.
func (r *ForwardMediaRepo) Save(ctx context.Context, uid, hash string, snapshot models.ForwardMessageSnapshot) (models.ForwardMessageSnapshot, error) {
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return models.ForwardMessageSnapshot{}, err
	}
	_, err = mediaQueries(ctx, r.DB).Exec(ctx, `INSERT INTO forward_media_snapshots(user_id, source_hash, snapshot)
		VALUES($1::uuid,$2,$3::jsonb) ON CONFLICT(user_id,source_hash) DO NOTHING`, uid, hash, raw)
	if err != nil {
		return models.ForwardMessageSnapshot{}, err
	}
	return r.Get(ctx, uid, hash)
}

// ArchiveMedia only replaces a snapshot that is still the one we copied.
func (r *ForwardRepo) ArchiveMedia(ctx context.Context, task models.ForwardTask, snapshot models.ForwardMessageSnapshot) error {
	before, err := json.Marshal(task.SourceSnapshot)
	if err != nil {
		return err
	}
	after, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	tag, err := mediaQueries(ctx, r.DB).Exec(ctx, `UPDATE forward_tasks SET source_snapshot=$3::jsonb,
		media_archived=TRUE, updated_at=NOW() WHERE id=$1::uuid AND user_id=$2::uuid
		AND NOT media_archived AND source_snapshot=$4::jsonb`, task.ID, task.UserID, after, before)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrForwardTaskState
	}
	return err
}
