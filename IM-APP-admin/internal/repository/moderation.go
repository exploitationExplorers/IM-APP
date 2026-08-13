package repository

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 敏感词与资料审核（清单 09） =====

func (r *OpsRepo) ListSensitiveWords(ctx context.Context, keyword string) ([]models.SensitiveWord, error) {
	where := ""
	if keyword != "" {
		where = " WHERE word ILIKE '%'||$1||'%'"
	}
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, word, category, status, created_at FROM sensitive_words`+where+` ORDER BY created_at DESC`, keyword)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.SensitiveWord, 0)
	for rows.Next() {
		var w models.SensitiveWord
		if err := rows.Scan(&w.ID, &w.Word, &w.Category, &w.Status, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, nil
}

func (r *OpsRepo) CreateSensitiveWord(ctx context.Context, w models.SensitiveWord) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO sensitive_words(word, category, status) VALUES($1,$2,COALESCE(NULLIF($3,''),'active'))`,
		w.Word, w.Category, w.Status)
	return err
}

func (r *OpsRepo) ImportSensitiveWords(ctx context.Context, words []string, category string) (int, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	n := 0
	for _, w := range words {
		tag, err := tx.Exec(ctx, `
			INSERT INTO sensitive_words(word, category) VALUES($1,$2) ON CONFLICT (word) DO NOTHING`, w, category)
		if err != nil {
			return 0, err
		}
		n += int(tag.RowsAffected())
	}
	return n, tx.Commit(ctx)
}

func (r *OpsRepo) UpdateSensitiveWord(ctx context.Context, id string, w models.SensitiveWord) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE sensitive_words SET word=COALESCE($2,word), category=COALESCE($3,category), status=COALESCE($4,status)
		WHERE id=$1::uuid`, id, w.Word, w.Category, w.Status)
	return err
}

func (r *OpsRepo) SetSensitiveWordStatus(ctx context.Context, id, status string) error {
	_, err := r.DB.Exec(ctx, `UPDATE sensitive_words SET status=$2 WHERE id=$1::uuid`, id, status)
	return err
}

func (r *OpsRepo) ListModerationHits(ctx context.Context, page, size int) ([]models.ModerationHit, int64, error) {
	var total int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM moderation_hits`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT id, COALESCE(user_id::text,''), field, content, matched_word, category, disposition, created_at
		FROM moderation_hits ORDER BY created_at DESC LIMIT $1 OFFSET $2`, size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ModerationHit, 0)
	for rows.Next() {
		var h models.ModerationHit
		if err := rows.Scan(&h.ID, &h.UserID, &h.Field, &h.Content, &h.MatchedWord, &h.Category, &h.Disposition, &h.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, h)
	}
	return out, total, nil
}

func (r *OpsRepo) ListProfileModerations(ctx context.Context, status string, page, size int) ([]models.ProfileModeration, int64, error) {
	where := ""
	if status != "" && status != "all" {
		where = " WHERE status=$1"
	}
	var total int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM profile_moderation_records`+where, status).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT id, user_id::text, field, old_value, new_value, status, reason, handled_at
		FROM profile_moderation_records`+where+`
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, status, size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ProfileModeration, 0)
	for rows.Next() {
		var p models.ProfileModeration
		if err := rows.Scan(&p.ID, &p.UserID, &p.Field, &p.OldValue, &p.NewValue, &p.Status, &p.Reason, &p.HandledAt); err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, nil
}

func (r *OpsRepo) HandleProfileModeration(ctx context.Context, userID, field, toStatus, reason, handlerID string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO profile_moderation_records(user_id, field, old_value, new_value, status, reason, handler_id, handled_at)
		VALUES($1::uuid,$2, '', '', $3,$4,$5::uuid, NOW())
		ON CONFLICT DO NOTHING`, userID, field, toStatus, reason, handlerID)
	return err
}
