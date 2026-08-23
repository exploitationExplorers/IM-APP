package repository

import (
	"context"
	"errors"
	"fmt"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ContactRepo struct {
	DB *pgxpool.Pool
}

const contactListWhere = `
		FROM friendships f
		JOIN users u ON u.id = f.friend_id
		WHERE f.user_id=$1::uuid
		AND ($2='' OR u.nickname ILIKE '%'||$2||'%' ESCAPE '\'
		     OR COALESCE(f.remark,'') ILIKE '%'||$2||'%' ESCAPE '\'
		     OR COALESCE(u.public_id,'') ILIKE '%'||$2||'%' ESCAPE '\')`

func (r *ContactRepo) ListContacts(ctx context.Context, uid, keyword, sort, cursor string, limit int) (models.ContactPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	page := models.ContactPage{Items: make([]models.Contact, 0)}
	// 翻页时不做 COUNT(*)，避免大通讯录双扫
	if cursor == "" {
		if err := r.DB.QueryRow(ctx, `SELECT COUNT(*)`+contactListWhere, uid, keyword).Scan(&page.Total); err != nil {
			return page, err
		}
	}

	order := `ORDER BY f.created_at DESC, f.friend_id DESC`
	cursorSQL := `AND (NULLIF($3,'') IS NULL OR (f.created_at, f.friend_id) < (
			SELECT f2.created_at, f2.friend_id FROM friendships f2
			WHERE f2.user_id=$1::uuid AND f2.friend_id=NULLIF($3,'')::uuid))`
	if sort == "name" {
		order = `ORDER BY LOWER(COALESCE(NULLIF(TRIM(f.remark),''), u.nickname)) ASC, f.friend_id ASC`
		cursorSQL = `AND (NULLIF($3,'') IS NULL OR (
			LOWER(COALESCE(NULLIF(TRIM(f.remark),''), u.nickname)), f.friend_id) > (
				SELECT LOWER(COALESCE(NULLIF(TRIM(f2.remark),''), u2.nickname)), f2.friend_id
				FROM friendships f2 JOIN users u2 ON u2.id=f2.friend_id
				WHERE f2.user_id=$1::uuid AND f2.friend_id=NULLIF($3,'')::uuid)))`
	}

	rows, err := r.DB.Query(ctx, `
		SELECT u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, COALESCE(f.remark,'')
		`+contactListWhere+cursorSQL+`
		`+order+` LIMIT $4`, uid, keyword, cursor, limit+1)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	items := make([]models.Contact, 0, limit+1)
	for rows.Next() {
		var item models.Contact
		if err := rows.Scan(&item.ID, &item.PublicID, &item.Nickname, &item.Avatar, &item.Remark); err != nil {
			return page, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return page, err
	}
	page.Items = items
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
		page.NextCursor = page.Items[len(page.Items)-1].ID
	}
	return page, nil
}

func (r *ContactRepo) ListGroups(ctx context.Context, uid, role, cursor string, limit int) (models.GroupPage, error) {
	page := models.GroupPage{Items: make([]models.GroupPreview, 0)}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `
		SELECT g.public_id, g.name, g.avatar, gm.role, COALESCE(g.conversation_id::text,''), COALESCE(g.status,'active')
		FROM groups g
		JOIN group_members gm ON gm.group_id = g.id
		WHERE gm.user_id=$1 AND COALESCE(gm.status,'active')='active' AND COALESCE(g.status,'active') IN ('active','dismissed')`
	args := []interface{}{uid}
	argIdx := 2
	if role == "owner" {
		query += ` AND gm.role='owner'`
	} else if role == "joined" || role == "member" {
		query += ` AND gm.role <> 'owner'`
	} else if role == "admin" {
		query += ` AND gm.role='admin'`
	}
	if cursor != "" {
		query += fmt.Sprintf(` AND (g.created_at, g.public_id) < (
			SELECT g2.created_at, g2.public_id FROM groups g2 WHERE g2.public_id=$%d)`, argIdx)
		args = append(args, cursor)
		argIdx++
	}
	query += fmt.Sprintf(` ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END, g.created_at DESC, g.public_id DESC LIMIT $%d`, argIdx)
	args = append(args, limit+1)
	rows, err := r.DB.Query(ctx, query, args...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	items := make([]models.GroupPreview, 0, limit+1)
	for rows.Next() {
		var g models.GroupPreview
		if err := rows.Scan(&g.ID, &g.Name, &g.Avatar, &g.Role, &g.ConversationID, &g.Status); err != nil {
			return page, err
		}
		items = append(items, g)
	}
	if err := rows.Err(); err != nil {
		return page, err
	}
	if len(items) > limit {
		page.HasMore = true
		page.Items = items[:limit]
		page.NextCursor = page.Items[len(page.Items)-1].ID
	} else {
		page.Items = items
	}
	return page, nil
}

const friendRequestListLimit = 100

const friendRequestSelectReceived = `
	SELECT fr.id::text, u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar,
		fr.message, fr.status, fr.created_at`

func scanFriendRequestRows(rows pgx.Rows) ([]models.FriendRequest, error) {
	list := make([]models.FriendRequest, 0)
	for rows.Next() {
		var fr models.FriendRequest
		if err := rows.Scan(&fr.ID, &fr.FromUser.ID, &fr.FromUser.PublicID,
			&fr.FromUser.Nickname, &fr.FromUser.Avatar, &fr.Message, &fr.Status, &fr.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, fr)
	}
	return list, rows.Err()
}

func (r *ContactRepo) ListFriendRequests(ctx context.Context, uid, direction string) (models.FriendRequestList, error) {
	empty := models.FriendRequestList{Pending: []models.FriendRequest{}, Recent: []models.FriendRequest{}}
	if direction == "sent" {
		rows, err := r.DB.Query(ctx, `
			`+friendRequestSelectReceived+`
			FROM (
				SELECT DISTINCT ON (to_user) * FROM friend_requests
				WHERE from_user=$1 AND status='pending'
				ORDER BY to_user, created_at DESC, id DESC
			) fr
			JOIN users u ON u.id = fr.to_user
			ORDER BY fr.created_at DESC
			LIMIT $2`, uid, friendRequestListLimit)
		if err != nil {
			return empty, err
		}
		defer rows.Close()
		pending, err := scanFriendRequestRows(rows)
		if err != nil {
			return empty, err
		}
		empty.Pending = pending
		return empty, nil
	}

	pendingRows, err := r.DB.Query(ctx, `
		`+friendRequestSelectReceived+`
		FROM (
			SELECT DISTINCT ON (from_user) * FROM friend_requests
			WHERE to_user=$1 AND status='pending'
			ORDER BY from_user, created_at DESC, id DESC
		) fr
		JOIN users u ON u.id = fr.from_user
		ORDER BY fr.created_at DESC
		LIMIT $2`, uid, friendRequestListLimit)
	if err != nil {
		return empty, err
	}
	defer pendingRows.Close()
	pending, err := scanFriendRequestRows(pendingRows)
	if err != nil {
		return empty, err
	}

	recentRows, err := r.DB.Query(ctx, `
		`+friendRequestSelectReceived+`
		FROM (
			SELECT DISTINCT ON (from_user) * FROM friend_requests
			WHERE to_user=$1
				AND status IN ('accepted', 'rejected')
				AND from_user NOT IN (
					SELECT from_user FROM friend_requests
					WHERE to_user=$1 AND status='pending'
				)
			ORDER BY from_user, created_at DESC, id DESC
		) fr
		JOIN users u ON u.id = fr.from_user
		ORDER BY fr.created_at DESC
		LIMIT $2`, uid, friendRequestListLimit)
	if err != nil {
		return empty, err
	}
	defer recentRows.Close()
	recent, err := scanFriendRequestRows(recentRows)
	if err != nil {
		return empty, err
	}

	return models.FriendRequestList{Pending: pending, Recent: recent}, nil
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
		ON CONFLICT (from_user, to_user) WHERE status='pending'
		DO UPDATE SET message=EXCLUDED.message, source=EXCLUDED.source,
			source_group_id=EXCLUDED.source_group_id, created_at=NOW()
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
	if err := EnqueueIMSyncTx(ctx, tx, IMEventFriendAccepted, toID, map[string]string{
		"friendUserId": fromID,
	}); err != nil {
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
		JOIN users u1 ON u1.id=gm1.user_id AND COALESCE(u1.status,'active')='active'
		JOIN users u2 ON u2.id=gm2.user_id AND COALESCE(u2.status,'active')='active'
		WHERE g.id=$3::uuid AND COALESCE(g.status,'active')='active'`, uid, toUserID, groupID).Scan(&allow)
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
		SELECT u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, COALESCE(f.remark,''),
			EXISTS(SELECT 1 FROM user_blocks b WHERE b.user_id=$1::uuid AND b.blocked_id=f.friend_id)
		FROM friendships f
		JOIN users u ON u.id = f.friend_id
		WHERE f.user_id=$1 AND f.friend_id=$2`, uid, friendID,
	).Scan(&item.ID, &item.PublicID, &item.Nickname, &item.Avatar, &item.Remark, &item.IsBlocked)
	return item, err
}

// ListCommonGroups 双方共同所在的群
func (r *ContactRepo) ListCommonGroups(ctx context.Context, uid, friendID string) ([]models.GroupPreview, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT g.public_id, g.name, COALESCE(g.avatar,''), COALESCE(g.conversation_id::text, '')
		FROM groups g
		JOIN group_members gm1 ON gm1.group_id=g.id AND gm1.user_id=$1::uuid
		JOIN group_members gm2 ON gm2.group_id=g.id AND gm2.user_id=$2::uuid
		WHERE COALESCE(g.status,'active')='active'
		ORDER BY g.created_at DESC`, uid, friendID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.GroupPreview, 0)
	for rows.Next() {
		var item models.GroupPreview
		if err := rows.Scan(&item.ID, &item.Name, &item.Avatar, &item.ConversationID); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, nil
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
	// 兼容唯一索引上线前产生的重复申请：接受任意一条后，同一方向全部结束。
	if _, err = tx.Exec(ctx, `
		UPDATE friend_requests SET status='accepted'
		WHERE from_user=$1::uuid AND to_user=$2::uuid AND status='pending'`, fromID, toID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO friendships(user_id, friend_id) VALUES($1::uuid,$2::uuid),($2::uuid,$1::uuid)
		ON CONFLICT DO NOTHING`, fromID, toID)
	if err != nil {
		return err
	}
	if err := EnqueueIMSyncTx(ctx, tx, IMEventFriendAccepted, toID, map[string]string{
		"friendUserId": fromID,
	}); err != nil {
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
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		DELETE FROM friendships
		WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)`,
		uid, friendID)
	if err != nil {
		return err
	}
	if err := EnqueueIMSyncTx(ctx, tx, IMEventFriendDeleted, uid, map[string]string{
		"friendUserId": friendID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ContactRepo) BlockUser(ctx context.Context, uid, blockedID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// 拉黑仅屏蔽消息往来，不删除好友关系；解除黑名单后关系保持原样。
	_, err = tx.Exec(ctx, `
		INSERT INTO user_blocks(user_id, blocked_id) VALUES($1,$2)
		ON CONFLICT DO NOTHING`, uid, blockedID)
	if err != nil {
		return err
	}
	if err := EnqueueIMSyncTx(ctx, tx, IMEventBlockAdded, uid, map[string]string{
		"blockedUserId": blockedID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ContactRepo) UnblockUser(ctx context.Context, uid, blockedID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		DELETE FROM user_blocks WHERE user_id=$1 AND blocked_id=$2`, uid, blockedID)
	if err != nil {
		return err
	}
	if err := EnqueueIMSyncTx(ctx, tx, IMEventBlockRemoved, uid, map[string]string{
		"blockedUserId": blockedID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ContactRepo) IsBlocked(ctx context.Context, uid, otherID string) (bool, error) {
	var exists bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM user_blocks WHERE user_id=$1 AND blocked_id=$2)`,
		uid, otherID).Scan(&exists)
	return exists, err
}

// ListBlockedUsers 当前用户拉黑的所有人，按拉黑时间倒序。
// keyword 为空时不附加搜索条件；limit<=0 或 >100 默认 100。
func (r *ContactRepo) ListBlockedUsers(ctx context.Context, uid, keyword string, limit int) ([]models.BlockedUser, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	var total int64
	if err := r.DB.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM user_blocks b
		JOIN users u ON u.id = b.blocked_id
		WHERE b.user_id = $1::uuid
		  AND ($2 = '' OR u.nickname ILIKE '%' || $2 || '%')`,
		uid, keyword).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT b.blocked_id::text, COALESCE(u.public_id,''), u.nickname, u.avatar, b.created_at
		FROM user_blocks b
		JOIN users u ON u.id = b.blocked_id
		WHERE b.user_id = $1::uuid
		  AND ($2 = '' OR u.nickname ILIKE '%' || $2 || '%')
		ORDER BY b.created_at DESC
		LIMIT $3`,
		uid, keyword, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]models.BlockedUser, 0)
	for rows.Next() {
		var u models.BlockedUser
		if err := rows.Scan(&u.ID, &u.PublicID, &u.Nickname, &u.Avatar, &u.BlockedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, u)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, total, nil
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
