package repository

import (
	"context"
	"encoding/json"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PrivacyRepo struct {
	DB *pgxpool.Pool
}

// DefaultPrivacySettings 在尚未发布配置时默认要求用户确认。
func DefaultPrivacySettings() models.PrivacySettings {
	return models.PrivacySettings{RequireFriendApproval: true, RequireGroupApproval: true}
}

// LoadPrivacyDefaults 仅使用已发布配置；草稿不会影响新用户。
func LoadPrivacyDefaults(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (models.PrivacySettings, error) {
	defaults := DefaultPrivacySettings()
	var raw string
	err := q.QueryRow(ctx, `SELECT data_json FROM app_config_versions
		WHERE status='published' ORDER BY version DESC, id DESC LIMIT 1`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	if raw == "" {
		return defaults, nil
	}
	var configured struct {
		Friend *bool `json:"defaultRequireFriendApproval"`
		Group  *bool `json:"defaultRequireGroupApproval"`
	}
	if err := json.Unmarshal([]byte(raw), &configured); err != nil {
		return defaults, err
	}
	if configured.Friend != nil {
		defaults.RequireFriendApproval = *configured.Friend
	}
	if configured.Group != nil {
		defaults.RequireGroupApproval = *configured.Group
	}
	return defaults, nil
}

func (r *PrivacyRepo) Ensure(ctx context.Context, uid string) error {
	defaults, err := LoadPrivacyDefaults(ctx, r.DB)
	if err != nil {
		return err
	}
	_, err = r.DB.Exec(ctx, `
		INSERT INTO privacy_settings(user_id, require_friend_approval, require_group_approval)
		VALUES($1::uuid, $2, $3)
		ON CONFLICT (user_id) DO NOTHING`, uid, defaults.RequireFriendApproval, defaults.RequireGroupApproval)
	return err
}

func (r *PrivacyRepo) Get(ctx context.Context, uid string) (models.PrivacySettings, error) {
	var s models.PrivacySettings
	const query = `
		SELECT require_friend_approval, require_group_approval
		FROM privacy_settings WHERE user_id=$1::uuid`
	err := r.DB.QueryRow(ctx, query, uid).Scan(&s.RequireFriendApproval, &s.RequireGroupApproval)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := r.Ensure(ctx, uid); err != nil {
			return s, err
		}
		err = r.DB.QueryRow(ctx, query, uid).Scan(&s.RequireFriendApproval, &s.RequireGroupApproval)
	}
	return s, err
}

func (r *PrivacyRepo) Update(ctx context.Context, uid string, s models.PrivacySettings) (models.PrivacySettings, error) {
	err := r.DB.QueryRow(ctx, `
		INSERT INTO privacy_settings(user_id, require_friend_approval, require_group_approval)
		VALUES($1::uuid, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET require_friend_approval=EXCLUDED.require_friend_approval,
		    require_group_approval=EXCLUDED.require_group_approval,
		    updated_at=NOW()
		RETURNING require_friend_approval, require_group_approval`,
		uid, s.RequireFriendApproval, s.RequireGroupApproval,
	).Scan(&s.RequireFriendApproval, &s.RequireGroupApproval)
	return s, err
}
