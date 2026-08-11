package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupRepo struct {
	DB *pgxpool.Pool
}

func (r *GroupRepo) Create(ctx context.Context, ownerID, name string, memberIDs []string) (models.GroupInfo, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.GroupInfo{}, err
	}
	defer tx.Rollback(ctx)

	var convID string
	err = tx.QueryRow(ctx, `
		INSERT INTO conversations(type, title, avatar)
		VALUES('group', $1, '')
		RETURNING id::text`, name).Scan(&convID)
	if err != nil {
		return models.GroupInfo{}, err
	}

	var groupID string
	err = tx.QueryRow(ctx, `
		INSERT INTO groups(name, avatar, owner_id, conversation_id, allow_member_add_friend)
		VALUES($1, '', $2::uuid, $3::uuid, true)
		RETURNING id::text`, name, ownerID, convID).Scan(&groupID)
	if err != nil {
		return models.GroupInfo{}, err
	}

	allMembers := append([]string{ownerID}, memberIDs...)
	seen := map[string]bool{}
	for _, uid := range allMembers {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		role := "member"
		if uid == ownerID {
			role = "owner"
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO group_members(group_id, user_id, role) VALUES($1::uuid, $2::uuid, $3)
			ON CONFLICT DO NOTHING`, groupID, uid, role)
		if err != nil {
			return models.GroupInfo{}, err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO conversation_members(conversation_id, user_id, unread_count)
			VALUES($1::uuid, $2::uuid, 0)
			ON CONFLICT DO NOTHING`, convID, uid)
		if err != nil {
			return models.GroupInfo{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return models.GroupInfo{}, err
	}
	return r.GetByID(ctx, groupID, ownerID)
}

func (r *GroupRepo) GetByID(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	var g models.GroupInfo
	var allow bool
	err := r.DB.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.avatar, g.owner_id::text,
			(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
			g.announcement, g.allow_member_add_friend, COALESCE(g.conversation_id::text,'')
		FROM groups g
		JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=$2
		WHERE g.id=$1`, groupID, uid).Scan(
		&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount,
		&g.Announcement, &allow, &g.ConversationID)
	g.AllowMemberAddFriend = allow
	return g, err
}

func (r *GroupRepo) ListMembers(ctx context.Context, groupID, uid string) ([]models.GroupMember, error) {
	var exists bool
	_ = r.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2)`,
		groupID, uid).Scan(&exists)
	if !exists {
		return nil, ErrForbidden
	}
	rows, err := r.DB.Query(ctx, `
		SELECT u.id::text, u.nickname, u.avatar, gm.role
		FROM group_members gm
		JOIN users u ON u.id = gm.user_id
		WHERE gm.group_id=$1
		ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`,
		groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.GroupMember, 0)
	for rows.Next() {
		var m models.GroupMember
		if err := rows.Scan(&m.ID, &m.Nickname, &m.Avatar, &m.Role); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, nil
}

func (r *GroupRepo) Join(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	var convID string
	err := r.DB.QueryRow(ctx, `SELECT conversation_id::text FROM groups WHERE id=$1`, groupID).Scan(&convID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	_, err = r.DB.Exec(ctx, `
		INSERT INTO group_members(group_id, user_id, role) VALUES($1,$2,'member')
		ON CONFLICT DO NOTHING`, groupID, uid)
	if err != nil {
		return models.GroupInfo{}, err
	}
	_, _ = r.DB.Exec(ctx, `
		INSERT INTO conversation_members(conversation_id, user_id, unread_count)
		VALUES($1::uuid, $2::uuid, 0) ON CONFLICT DO NOTHING`, convID, uid)
	return r.GetByID(ctx, groupID, uid)
}

func (r *GroupRepo) UpdateSettings(ctx context.Context, groupID, uid string, announcement *string, allow *bool) error {
	var role string
	err := r.DB.QueryRow(ctx, `
		SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2`, groupID, uid).Scan(&role)
	if err != nil || (role != "owner" && role != "admin") {
		return ErrForbidden
	}
	_, err = r.DB.Exec(ctx, `
		UPDATE groups SET
			announcement = COALESCE($2, announcement),
			allow_member_add_friend = COALESCE($3, allow_member_add_friend)
		WHERE id=$1`, groupID, announcement, allow)
	return err
}

func (r *GroupRepo) Leave(ctx context.Context, groupID, uid string) error {
	var convID string
	_ = r.DB.QueryRow(ctx, `SELECT conversation_id::text FROM groups WHERE id=$1`, groupID).Scan(&convID)
	_, err := r.DB.Exec(ctx, `DELETE FROM group_members WHERE group_id=$1 AND user_id=$2`, groupID, uid)
	if err != nil {
		return err
	}
	if convID != "" {
		_, _ = r.DB.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, convID, uid)
	}
	return nil
}

// ErrForbidden 无权访问
var ErrForbidden = errors.New("forbidden")
