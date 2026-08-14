package repository

import (
	"context"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PrivacyRepo struct {
	DB *pgxpool.Pool
}

func (r *PrivacyRepo) Ensure(ctx context.Context, uid string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO privacy_settings(user_id)
		VALUES($1::uuid)
		ON CONFLICT (user_id) DO NOTHING`, uid)
	return err
}

func (r *PrivacyRepo) Get(ctx context.Context, uid string) (models.PrivacySettings, error) {
	if err := r.Ensure(ctx, uid); err != nil {
		return models.PrivacySettings{}, err
	}
	var s models.PrivacySettings
	err := r.DB.QueryRow(ctx, `
		SELECT require_friend_approval, require_group_approval
		FROM privacy_settings WHERE user_id=$1::uuid`, uid,
	).Scan(&s.RequireFriendApproval, &s.RequireGroupApproval)
	return s, err
}

func (r *PrivacyRepo) Update(ctx context.Context, uid string, s models.PrivacySettings) (models.PrivacySettings, error) {
	if err := r.Ensure(ctx, uid); err != nil {
		return models.PrivacySettings{}, err
	}
	err := r.DB.QueryRow(ctx, `
		UPDATE privacy_settings
		SET require_friend_approval=$2,
		    require_group_approval=$3,
		    updated_at=NOW()
		WHERE user_id=$1::uuid
		RETURNING require_friend_approval, require_group_approval`,
		uid, s.RequireFriendApproval, s.RequireGroupApproval,
	).Scan(&s.RequireFriendApproval, &s.RequireGroupApproval)
	return s, err
}
