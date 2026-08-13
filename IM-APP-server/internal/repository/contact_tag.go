package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ContactTagRepo struct {
	DB *pgxpool.Pool
}

func (r *ContactTagRepo) List(ctx context.Context, uid string) ([]models.ContactTagItem, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT t.id::text, t.name,
			(SELECT COUNT(*) FROM contact_tag_members m WHERE m.tag_id=t.id)
		FROM contact_tags t
		WHERE t.user_id=$1::uuid
		ORDER BY t.created_at ASC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.ContactTagItem, 0)
	for rows.Next() {
		var item models.ContactTagItem
		if err := rows.Scan(&item.ID, &item.Name, &item.MemberCount); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, nil
}

func (r *ContactTagRepo) Create(ctx context.Context, uid, name string) (models.ContactTagItem, error) {
	var item models.ContactTagItem
	err := r.DB.QueryRow(ctx, `
		INSERT INTO contact_tags(user_id, name) VALUES($1::uuid, $2)
		RETURNING id::text, name`, uid, name,
	).Scan(&item.ID, &item.Name)
	item.MemberCount = 0
	return item, err
}

func (r *ContactTagRepo) Update(ctx context.Context, uid, tagID, name string) (models.ContactTagItem, error) {
	var item models.ContactTagItem
	err := r.DB.QueryRow(ctx, `
		UPDATE contact_tags SET name=$3
		WHERE id=$2::uuid AND user_id=$1::uuid
		RETURNING id::text, name`, uid, tagID, name,
	).Scan(&item.ID, &item.Name)
	if err != nil {
		return item, err
	}
	_ = r.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM contact_tag_members WHERE tag_id=$1::uuid`, tagID,
	).Scan(&item.MemberCount)
	return item, nil
}

func (r *ContactTagRepo) Delete(ctx context.Context, uid, tagID string) error {
	tag, err := r.DB.Exec(ctx, `
		DELETE FROM contact_tags WHERE id=$2::uuid AND user_id=$1::uuid`, uid, tagID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not found")
	}
	return nil
}

func (r *ContactTagRepo) SetMembers(ctx context.Context, uid, tagID string, friendIDs []string) (models.ContactTagItem, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.ContactTagItem{}, err
	}
	defer tx.Rollback(ctx)

	var item models.ContactTagItem
	err = tx.QueryRow(ctx, `
		SELECT id::text, name FROM contact_tags WHERE id=$2::uuid AND user_id=$1::uuid`,
		uid, tagID).Scan(&item.ID, &item.Name)
	if err != nil {
		return models.ContactTagItem{}, err
	}

	_, err = tx.Exec(ctx, `DELETE FROM contact_tag_members WHERE tag_id=$1::uuid`, tagID)
	if err != nil {
		return models.ContactTagItem{}, err
	}

	for _, fid := range friendIDs {
		var isFriend bool
		_ = tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM friendships WHERE user_id=$1::uuid AND friend_id=$2::uuid)`,
			uid, fid).Scan(&isFriend)
		if !isFriend {
			continue
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO contact_tag_members(tag_id, friend_id) VALUES($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING`, tagID, fid)
		if err != nil {
			return models.ContactTagItem{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return models.ContactTagItem{}, err
	}
	_ = r.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM contact_tag_members WHERE tag_id=$1::uuid`, tagID,
	).Scan(&item.MemberCount)
	return item, nil
}

func (r *ContactTagRepo) ListMembers(ctx context.Context, uid, tagID string) ([]models.Contact, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, f.remark
		FROM contact_tag_members m
		JOIN contact_tags t ON t.id=m.tag_id AND t.user_id=$1::uuid
		JOIN users u ON u.id=m.friend_id
		JOIN friendships f ON f.user_id=$1::uuid AND f.friend_id=m.friend_id
		WHERE m.tag_id=$2::uuid
		ORDER BY u.nickname`, uid, tagID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Contact, 0)
	for rows.Next() {
		var item models.Contact
		if err := rows.Scan(&item.ID, &item.PublicID, &item.Nickname, &item.Avatar, &item.Remark); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, nil
}
