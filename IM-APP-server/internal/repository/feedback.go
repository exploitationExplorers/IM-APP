package repository

import (
	"context"
	"errors"
	"time"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrFeedbackImageInvalid = errors.New("feedback image invalid")
	ErrFeedbackTooFrequent  = errors.New("feedback too frequent")
)

type FeedbackRepo struct {
	DB *pgxpool.Pool
}

func (r *FeedbackRepo) Create(ctx context.Context, userID, contact, content, imageFileID string) (models.FeedbackResult, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.FeedbackResult{}, err
	}
	defer tx.Rollback(ctx)

	var recent bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM feedbacks
			WHERE user_id=$1::uuid AND created_at > NOW() - INTERVAL '60 seconds'
		)`, userID).Scan(&recent); err != nil {
		return models.FeedbackResult{}, err
	}
	if recent {
		return models.FeedbackResult{}, ErrFeedbackTooFrequent
	}

	var imageArg *string
	if imageFileID != "" {
		var ok bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM files
				WHERE id=$1::uuid AND owner_id=$2::uuid AND status='ready'
				  AND purpose='image' AND content_type LIKE 'image/%'
				  AND size > 0 AND size <= 10485760
			)`, imageFileID, userID).Scan(&ok); err != nil {
			return models.FeedbackResult{}, err
		}
		if !ok {
			return models.FeedbackResult{}, ErrFeedbackImageInvalid
		}
		imageArg = &imageFileID
	}

	var id string
	var createdAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO feedbacks(user_id, contact, content, image_file_id, status)
		VALUES($1::uuid, $2, $3, $4::uuid, 'pending')
		RETURNING id::text, created_at`,
		userID, contact, content, imageArg,
	).Scan(&id, &createdAt); err != nil {
		return models.FeedbackResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.FeedbackResult{}, err
	}
	return models.FeedbackResult{
		ID:        id,
		CreatedAt: createdAt.UTC().Format(time.RFC3339),
	}, nil
}
