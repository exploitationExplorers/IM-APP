package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ContactRepo struct {
	DB *pgxpool.Pool
}

func (r *ContactRepo) ListContacts(ctx context.Context, uid string) ([]models.Contact, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, f.remark
		FROM friendships f
		JOIN users u ON u.id = f.friend_id
		WHERE f.user_id=$1
		AND NOT EXISTS (
			SELECT 1 FROM user_blocks b WHERE b.user_id=$1 AND b.blocked_id=f.friend_id
		)
		ORDER BY f.created_at DESC`, uid)
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

func (r *ContactRepo) ListGroups(ctx context.Context, uid, role string) ([]models.GroupPreview, error) {
	query := `
		SELECT g.id::text, g.name, g.avatar, gm.role, COALESCE(g.conversation_id::text,'')
		FROM groups g
		JOIN group_members gm ON gm.group_id = g.id
		WHERE gm.user_id=$1 AND COALESCE(g.status,'active')='active'`
	args := []interface{}{uid}
	if role == "owner" {
		query += ` AND gm.role='owner'`
	} else if role == "joined" || role == "member" {
		query += ` AND gm.role <> 'owner'`
	} else if role == "admin" {
		query += ` AND gm.role='admin'`
	}
	query += ` ORDER BY g.created_at DESC`
	rows, err := r.DB.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.GroupPreview, 0)
	for rows.Next() {
		var g models.GroupPreview
		if err := rows.Scan(&g.ID, &g.Name, &g.Avatar, &g.Role, &g.ConversationID); err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	return list, nil
}

func (r *ContactRepo) ListFriendRequests(ctx context.Context, uid, direction string) ([]models.FriendRequest, error) {
	var query string
	var arg string
	if direction == "sent" {
		query = `
			SELECT fr.id::text, u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar,
				fr.message, fr.status, fr.created_at
			FROM friend_requests fr
			JOIN users u ON u.id = fr.to_user
			WHERE fr.from_user=$1 AND fr.status='pending'
			ORDER BY fr.created_at DESC`
		arg = uid
	} else {
		query = `
			SELECT fr.id::text, u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar,
				fr.message, fr.status, fr.created_at
			FROM friend_requests fr
			JOIN users u ON u.id = fr.from_user
			WHERE fr.to_user=$1 AND fr.status='pending'
			ORDER BY fr.created_at DESC`
		arg = uid
	}
	rows, err := r.DB.Query(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.FriendRequest, 0)
	for rows.Next() {
		var fr models.FriendRequest
		if err := rows.Scan(&fr.ID, &fr.FromUser.ID, &fr.FromUser.PublicID,
			&fr.FromUser.Nickname, &fr.FromUser.Avatar, &fr.Message, &fr.Status, &fr.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, fr)
	}
	return list, nil
}

func (r *ContactRepo) IsFriend(ctx context.Context, uid, friendID string) (bool, error) {
	var exists bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM friendships WHERE user_id=$1 AND friend_id=$2)`,
		uid, friendID).Scan(&exists)
	return exists, err
}

func (r *ContactRepo) CreateFriendRequest(ctx context.Context, fromID, toID, message, source, sourceGroupID string) (string, error) {
	var id string
	var groupID *string
	if sourceGroupID != "" {
		groupID = &sourceGroupID
	}
	err := r.DB.QueryRow(ctx, `
		INSERT INTO friend_requests(from_user, to_user, message, status, source, source_group_id)
		VALUES($1,$2,$3,'pending',$4,$5)
		RETURNING id::text`, fromID, toID, message, source, groupID).Scan(&id)
	return id, err
}

// AddFriendDirect 对方无需验证时直接互加好友，并记一条已通过申请
func (r *ContactRepo) AddFriendDirect(ctx context.Context, fromID, toID, message, source, sourceGroupID string) (string, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var groupID *string
	if sourceGroupID != "" {
		groupID = &sourceGroupID
	}
	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO friend_requests(from_user, to_user, message, status, source, source_group_id)
		VALUES($1,$2,$3,'accepted',$4,$5)
		RETURNING id::text`, fromID, toID, message, source, groupID).Scan(&id)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO friendships(user_id, friend_id) VALUES($1::uuid,$2::uuid),($2::uuid,$1::uuid)
		ON CONFLICT DO NOTHING`, fromID, toID)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

// IsGroupAddFriendAllowed 检查从某群加好友是否被允许
func (r *ContactRepo) IsGroupAddFriendAllowed(ctx context.Context, uid, toUserID, groupID string) (bool, error) {
	var allow bool
	err := r.DB.QueryRow(ctx, `
		SELECT g.allow_member_add_friend
		FROM groups g
		JOIN group_members gm1 ON gm1.group_id=g.id AND gm1.user_id=$1
		JOIN group_members gm2 ON gm2.group_id=g.id AND gm2.user_id=$2
		WHERE g.id=$3::uuid`, uid, toUserID, groupID).Scan(&allow)
	if err != nil {
		return false, err
	}
	return allow, nil
}

func (r *ContactRepo) UpdateContactRemark(ctx context.Context, uid, friendID, remark string) error {
	tag, err := r.DB.Exec(ctx, `
		UPDATE friendships SET remark=$3
		WHERE user_id=$1::uuid AND friend_id=$2::uuid`, uid, friendID, remark)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not found")
	}
	return nil
}

func (r *ContactRepo) GetContact(ctx context.Context, uid, friendID string) (models.Contact, error) {
	var item models.Contact
	err := r.DB.QueryRow(ctx, `
		SELECT u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, f.remark
		FROM friendships f
		JOIN users u ON u.id = f.friend_id
		WHERE f.user_id=$1 AND f.friend_id=$2`, uid, friendID,
	).Scan(&item.ID, &item.PublicID, &item.Nickname, &item.Avatar, &item.Remark)
	return item, err
}

func (r *ContactRepo) AcceptFriendRequest(ctx context.Context, requestID, uid string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var fromID, toID string
	err = tx.QueryRow(ctx, `
		UPDATE friend_requests SET status='accepted'
		WHERE id=$1 AND to_user=$2 AND status='pending'
		RETURNING from_user::text, to_user::text`, requestID, uid).Scan(&fromID, &toID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO friendships(user_id, friend_id) VALUES($1::uuid,$2::uuid),($2::uuid,$1::uuid)
		ON CONFLICT DO NOTHING`, fromID, toID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ContactRepo) RejectFriendRequest(ctx context.Context, requestID, uid string) error {
	tag, err := r.DB.Exec(ctx, `
		UPDATE friend_requests SET status='rejected'
		WHERE id=$1 AND to_user=$2 AND status='pending'`, requestID, uid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not found")
	}
	return nil
}

func (r *ContactRepo) DeleteFriend(ctx context.Context, uid, friendID string) error {
	_, err := r.DB.Exec(ctx, `
		DELETE FROM friendships
		WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`,
		uid, friendID)
	return err
}

func (r *ContactRepo) BlockUser(ctx context.Context, uid, blockedID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, _ = tx.Exec(ctx, `
		DELETE FROM friendships
		WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`,
		uid, blockedID)
	_, err = tx.Exec(ctx, `
		INSERT INTO user_blocks(user_id, blocked_id) VALUES($1,$2)
		ON CONFLICT DO NOTHING`, uid, blockedID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ContactRepo) UnblockUser(ctx context.Context, uid, blockedID string) error {
	_, err := r.DB.Exec(ctx, `
		DELETE FROM user_blocks WHERE user_id=$1 AND blocked_id=$2`, uid, blockedID)
	return err
}

func (r *ContactRepo) IsBlocked(ctx context.Context, uid, otherID string) (bool, error) {
	var exists bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM user_blocks WHERE user_id=$1 AND blocked_id=$2)`,
		uid, otherID).Scan(&exists)
	return exists, err
}

func (r *ContactRepo) HasPendingRequest(ctx context.Context, uid, otherID string) (bool, error) {
	var exists bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM friend_requests
			WHERE status='pending'
			  AND ((from_user=$1::uuid AND to_user=$2::uuid)
			    OR (from_user=$2::uuid AND to_user=$1::uuid))
		)`, uid, otherID).Scan(&exists)
	return exists, err
}

func (r *ContactRepo) GetOrCreatePrivateConversation(ctx context.Context, uid, contactID string) (string, error) {
	var convID string
	err := r.DB.QueryRow(ctx, `
		SELECT c.id::text FROM conversations c
		JOIN conversation_members cm1 ON cm1.conversation_id=c.id AND cm1.user_id=$1
		JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id=$2
		WHERE c.type='private' LIMIT 1`, uid, contactID).Scan(&convID)
	if err == nil {
		return convID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	var nickname, avatar string
	_ = r.DB.QueryRow(ctx, `SELECT nickname, avatar FROM users WHERE id=$1`, contactID).Scan(&nickname, &avatar)

	err = r.DB.QueryRow(ctx, `
		INSERT INTO conversations(type, title, avatar)
		VALUES('private', $1, $2)
		RETURNING id::text`, nickname, avatar).Scan(&convID)
	if err != nil {
		return "", err
	}
	_, err = r.DB.Exec(ctx, `
		INSERT INTO conversation_members(conversation_id, user_id, unread_count) VALUES
		($1::uuid, $2::uuid, 0),
		($1::uuid, $3::uuid, 0)`, convID, uid, contactID)
	return convID, err
}
