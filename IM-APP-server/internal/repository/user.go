package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"im-app-server/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserRepo struct {
	DB *pgxpool.Pool
}

func (r *UserRepo) FindByID(ctx context.Context, id string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at
		FROM users WHERE id=$1`, id,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

func (r *UserRepo) FindByPhone(ctx context.Context, phone string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at
		FROM users WHERE phone=$1`, phone,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

func (r *UserRepo) FindByPublicID(ctx context.Context, publicID string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at
		FROM users WHERE public_id=$1`, publicID,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

func (r *UserRepo) UpdateProfile(ctx context.Context, id string, nickname, avatar, bio *string) (models.User, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.User{}, err
	}
	defer tx.Rollback(ctx)
	var u models.User
	err = tx.QueryRow(ctx, `
		UPDATE users SET
			nickname = COALESCE($2, nickname),
			avatar = COALESCE($3, avatar),
			bio = COALESCE($4, bio),
			updated_at = NOW()
		WHERE id=$1
		RETURNING id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at`,
		id, nickname, avatar, bio,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	if err != nil {
		return u, err
	}
	if err := EnqueueIMSyncTx(ctx, tx, IMEventUserProfileUpdated, u.ID, map[string]string{
		"nickname": u.Nickname, "avatar": u.Avatar,
	}); err != nil {
		return models.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.User{}, err
	}
	return u, nil
}

func (r *UserRepo) NextPublicID(ctx context.Context) (string, error) {
	var count int
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return "", err
	}
	return fmt.Sprintf("chat%d", 10000+count+1), nil
}

func (r *UserRepo) Create(ctx context.Context, phone, countryCode, passwordHash, nickname, publicID string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id)
		VALUES($1,$2,$3,$4,'',$5)
		RETURNING id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at`,
		phone, countryCode, passwordHash, nickname, publicID,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

func PublicUser(u models.User) models.User {
	u.PasswordHash = ""
	return u
}

func (r *UserRepo) QrcodePayload(u models.User) models.QrcodePayload {
	payload, _ := json.Marshal(map[string]string{
		"type":     "user",
		"publicId": u.PublicID,
	})
	return models.QrcodePayload{
		PublicID: u.PublicID,
		Nickname: u.Nickname,
		Avatar:   u.Avatar,
		Payload:  string(payload),
	}
}

// EnsureQRCode 返回该用户有效二维码；无则生成唯一 token 并落库（注册成功即调用）
func (r *UserRepo) EnsureQRCode(ctx context.Context, userID string) (models.UserQR, error) {
	var token string
	var expiresAt *time.Time
	err := r.DB.QueryRow(ctx, `
		SELECT token, expires_at FROM user_qrcodes
		WHERE user_id=$1::uuid AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY created_at DESC LIMIT 1`, userID,
	).Scan(&token, &expiresAt)
	if err == nil {
		exp := time.Time{}
		if expiresAt != nil {
			exp = *expiresAt
		}
		return models.UserQR{Token: token, ExpiresAt: exp}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return models.UserQR{}, err
	}
	token = uuid.NewString()
	exp := time.Now().Add(365 * 24 * time.Hour)
	if _, err := r.DB.Exec(ctx, `
		INSERT INTO user_qrcodes(user_id, token, expires_at) VALUES($1::uuid,$2,$3)
		ON CONFLICT (token) DO NOTHING`, userID, token, exp); err != nil {
		return models.UserQR{}, err
	}
	return models.UserQR{Token: token, ExpiresAt: exp}, nil
}
