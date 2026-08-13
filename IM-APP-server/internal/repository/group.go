package repository

import (
	"context"
	"errors"

	"im-app-server/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupRepo struct {
	DB                *pgxpool.Pool
	LegacyChatEnabled bool
}

func (r *GroupRepo) Create(ctx context.Context, ownerID, name string, memberIDs []string) (models.GroupInfo, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.GroupInfo{}, err
	}
	defer tx.Rollback(ctx)
	var validMembers int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM users
		WHERE id::text = ANY($1::text[]) AND COALESCE(status,'active')='active'`, memberIDs).Scan(&validMembers); err != nil {
		return models.GroupInfo{}, err
	}
	if validMembers != len(memberIDs) {
		return models.GroupInfo{}, ErrInvalidGroupOperation
	}

	var convID string
	if r.LegacyChatEnabled {
		err = tx.QueryRow(ctx, `
			INSERT INTO conversations(type, title, avatar)
			VALUES('group', $1, '')
			RETURNING id::text`, name).Scan(&convID)
		if err != nil {
			return models.GroupInfo{}, err
		}
	}

	var groupID string
	err = tx.QueryRow(ctx, `
		INSERT INTO groups(name, avatar, owner_id, conversation_id, allow_member_add_friend)
		VALUES($1, '', $2::uuid, NULLIF($3,'')::uuid, true)
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
		if r.LegacyChatEnabled {
			_, err = tx.Exec(ctx, `
				INSERT INTO conversation_members(conversation_id, user_id, unread_count)
				VALUES($1::uuid, $2::uuid, 0)
				ON CONFLICT DO NOTHING`, convID, uid)
			if err != nil {
				return models.GroupInfo{}, err
			}
		}
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupCreated, map[string]any{
		"memberIds": allMembers,
	}); err != nil {
		return models.GroupInfo{}, err
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
		WHERE g.id=$1 AND g.status='active'`, groupID, uid).Scan(
		&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount,
		&g.Announcement, &allow, &g.ConversationID)
	g.AllowMemberAddFriend = allow
	return g, err
}

func (r *GroupRepo) ListMembers(ctx context.Context, groupID, uid string) ([]models.GroupMember, error) {
	var exists bool
	_ = r.DB.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
			WHERE gm.group_id=$1 AND gm.user_id=$2 AND g.status='active')`,
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
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.GroupInfo{}, err
	}
	defer tx.Rollback(ctx)
	var convID string
	err = tx.QueryRow(ctx, `SELECT COALESCE(conversation_id::text,'') FROM groups WHERE id=$1 AND status='active'`, groupID).Scan(&convID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO group_members(group_id, user_id, role) VALUES($1,$2,'member')
		ON CONFLICT DO NOTHING`, groupID, uid)
	if err != nil {
		return models.GroupInfo{}, err
	}
	if r.LegacyChatEnabled && convID != "" {
		_, err = tx.Exec(ctx, `
			INSERT INTO conversation_members(conversation_id, user_id, unread_count)
			VALUES($1::uuid, $2::uuid, 0) ON CONFLICT DO NOTHING`, convID, uid)
		if err != nil {
			return models.GroupInfo{}, err
		}
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMemberJoined, map[string]string{
		"userId": uid,
	}); err != nil {
		return models.GroupInfo{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.GroupInfo{}, err
	}
	return r.GetByID(ctx, groupID, uid)
}

func (r *GroupRepo) UpdateSettings(ctx context.Context, groupID, uid string, announcement *string, allow *bool) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var role string
	err = tx.QueryRow(ctx, `
		SELECT gm.role FROM group_members gm JOIN groups g ON g.id=gm.group_id
		WHERE gm.group_id=$1 AND gm.user_id=$2 AND g.status='active'`, groupID, uid).Scan(&role)
	if err != nil || (role != "owner" && role != "admin") {
		return ErrForbidden
	}
	_, err = tx.Exec(ctx, `
		UPDATE groups SET
			announcement = COALESCE($2, announcement),
			allow_member_add_friend = COALESCE($3, allow_member_add_friend),
			updated_at = NOW()
		WHERE id=$1`, groupID, announcement, allow)
	if err != nil {
		return err
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupUpdated, map[string]any{}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRepo) Leave(ctx context.Context, groupID, uid string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var convID string
	var role string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(g.conversation_id::text,''), gm.role
		FROM groups g JOIN group_members gm ON gm.group_id=g.id
		WHERE g.id=$1 AND gm.user_id=$2`, groupID, uid).Scan(&convID, &role)
	if err != nil {
		return err
	}
	if role == "owner" {
		return ErrForbidden
	}
	_, err = tx.Exec(ctx, `DELETE FROM group_members WHERE group_id=$1 AND user_id=$2`, groupID, uid)
	if err != nil {
		return err
	}
	if r.LegacyChatEnabled && convID != "" {
		if _, err := tx.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, convID, uid); err != nil {
			return err
		}
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMemberLeft, map[string]string{
		"userId": uid,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRepo) GetSyncState(ctx context.Context, groupID string) (models.IMGroupSyncState, error) {
	var state models.IMGroupSyncState
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, name, avatar, owner_id::text, announcement,
			allow_member_add_friend, status, all_muted
		FROM groups WHERE id=$1::uuid`, groupID).Scan(
		&state.ID, &state.Name, &state.Avatar, &state.OwnerID, &state.Announcement,
		&state.AllowMemberAddFriend, &state.Status, &state.AllMuted)
	if err != nil {
		return state, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT u.id::text, u.nickname, u.avatar, COALESCE(u.status,'active'), gm.role, gm.muted_until
		FROM group_members gm JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid
		ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`, groupID)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var member models.IMGroupSyncMember
		if err := rows.Scan(&member.ID, &member.Nickname, &member.Avatar, &member.Status, &member.Role, &member.MutedUntil); err != nil {
			return state, err
		}
		state.Members = append(state.Members, member)
	}
	return state, rows.Err()
}

func (r *GroupRepo) UpdateMemberRole(ctx context.Context, groupID, operatorID, memberID, role string) error {
	if role != "admin" && role != "member" {
		return ErrInvalidGroupOperation
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var operatorRole, currentRole string
	err = tx.QueryRow(ctx, `
		SELECT operator.role, target.role
		FROM groups g
		JOIN group_members operator ON operator.group_id=g.id AND operator.user_id=$2::uuid
		JOIN group_members target ON target.group_id=g.id AND target.user_id=$3::uuid
		WHERE g.id=$1::uuid AND g.status='active'`, groupID, operatorID, memberID).Scan(&operatorRole, &currentRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if operatorRole != "owner" || currentRole == "owner" || operatorID == memberID {
		return ErrForbidden
	}
	if currentRole == role {
		return tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `UPDATE group_members SET role=$3 WHERE group_id=$1 AND user_id=$2`, groupID, memberID, role); err != nil {
		return err
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMemberRole, map[string]any{
		"userId": memberID, "role": role,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRepo) UpdateMemberMute(ctx context.Context, groupID, operatorID, memberID string, mutedSeconds int64) error {
	if mutedSeconds < 0 || mutedSeconds > 30*24*60*60 {
		return ErrInvalidGroupOperation
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var operatorRole, targetRole string
	err = tx.QueryRow(ctx, `
		SELECT operator.role, target.role
		FROM groups g
		JOIN group_members operator ON operator.group_id=g.id AND operator.user_id=$2::uuid
		JOIN group_members target ON target.group_id=g.id AND target.user_id=$3::uuid
		WHERE g.id=$1::uuid AND g.status='active'`, groupID, operatorID, memberID).Scan(&operatorRole, &targetRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if operatorID == memberID || operatorRole == "member" || targetRole == "owner" ||
		(operatorRole == "admin" && targetRole != "member") {
		return ErrForbidden
	}
	if _, err := tx.Exec(ctx, `
		UPDATE group_members SET muted_until=
			CASE WHEN $3::bigint=0 THEN NULL ELSE NOW() + ($3 * INTERVAL '1 second') END
		WHERE group_id=$1 AND user_id=$2`, groupID, memberID, mutedSeconds); err != nil {
		return err
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMemberMute, map[string]any{
		"userId": memberID, "mutedSeconds": mutedSeconds,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRepo) UpdateGroupMute(ctx context.Context, groupID, operatorID string, muted bool) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var role string
	err = tx.QueryRow(ctx, `
		SELECT gm.role FROM groups g JOIN group_members gm ON gm.group_id=g.id
		WHERE g.id=$1 AND gm.user_id=$2 AND g.status='active'`, groupID, operatorID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && role != "owner" && role != "admin") {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE groups SET all_muted=$2, updated_at=NOW() WHERE id=$1`, groupID, muted); err != nil {
		return err
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMute, map[string]any{"muted": muted}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRepo) Dismiss(ctx context.Context, groupID, operatorID string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		UPDATE groups g SET status='dismissed', updated_at=NOW()
		FROM group_members gm
		WHERE g.id=$1 AND gm.group_id=g.id AND gm.user_id=$2
			AND gm.role='owner' AND g.status='active'`, groupID, operatorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrForbidden
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupDismissed, map[string]any{}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ErrForbidden 无权访问
var ErrForbidden = errors.New("forbidden")

var ErrInvalidGroupOperation = errors.New("invalid group operation")
