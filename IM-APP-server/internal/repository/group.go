package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"im-app-server/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupRepo struct {
	DB                *pgxpool.Pool
	LegacyChatEnabled bool
}

// InternalIDByPublicID resolves the short numeric ID used by clients to the
// UUID used by database relations and the existing OpenIM mapping.
func (r *GroupRepo) InternalIDByPublicID(ctx context.Context, publicID string) (string, error) {
	var groupID string
	err := r.DB.QueryRow(ctx, `
		SELECT id::text FROM groups WHERE public_id=$1`, publicID,
	).Scan(&groupID)
	return groupID, err
}

// PublicIDByInternalID is the inverse of InternalIDByPublicID: given the
// database group UUID (which also doubles as the OpenIM group ID source),
// return the public ID clients use in URLs.
func (r *GroupRepo) PublicIDByInternalID(ctx context.Context, internalID string) (string, error) {
	var publicID string
	err := r.DB.QueryRow(ctx, `
		SELECT public_id FROM groups WHERE id=$1::uuid`, internalID,
	).Scan(&publicID)
	if err != nil {
		return "", ErrIMTargetNotFound
	}
	return publicID, nil
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
		SELECT g.public_id, g.name, g.avatar, g.owner_id::text,
			(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
			g.announcement, g.allow_member_add_friend, COALESCE(g.conversation_id::text,''),
			gm.role, gm.nickname, g.join_mode, g.all_muted
		FROM groups g
		JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=$2
		WHERE g.id=$1 AND g.status='active'`, groupID, uid).Scan(
		&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount,
		&g.Announcement, &allow, &g.ConversationID, &g.MyRole, &g.MyNickname,
		&g.JoinMode, &g.AllMuted)
	g.AllowMemberAddFriend = allow
	if err == nil {
		canManage := g.MyRole == "owner" || g.MyRole == "admin"
		g.Permissions = &models.GroupPermissions{
			CanEditProfile: canManage, CanEditAnnouncement: canManage,
			CanViewQRCode: true, CanManageMembers: canManage,
			CanEditMyNickname: true, CanReport: true,
		}
	}
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
		SELECT u.id::text, u.nickname, gm.nickname,
			CASE WHEN gm.nickname='' THEN u.nickname ELSE gm.nickname END,
			u.avatar, gm.role
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
		if err := rows.Scan(&m.ID, &m.Nickname, &m.GroupNickname, &m.DisplayName, &m.Avatar, &m.Role); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, nil
}

func (r *GroupRepo) Join(ctx context.Context, groupID, uid string) (models.GroupInfo, error) {
	return r.addMember(ctx, groupID, uid, true)
}

func (r *GroupRepo) addMember(ctx context.Context, groupID, uid string, enforceJoinMode bool) (models.GroupInfo, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.GroupInfo{}, err
	}
	defer tx.Rollback(ctx)
	var convID, joinMode string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(conversation_id::text,''), join_mode
		FROM groups WHERE id=$1 AND status='active' FOR UPDATE`, groupID).Scan(&convID, &joinMode)
	if err != nil {
		return models.GroupInfo{}, err
	}
	var alreadyMember bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2)`, groupID, uid).Scan(&alreadyMember); err != nil {
		return models.GroupInfo{}, err
	}
	if alreadyMember {
		if err := tx.Commit(ctx); err != nil {
			return models.GroupInfo{}, err
		}
		return r.GetByID(ctx, groupID, uid)
	}
	if enforceJoinMode && joinMode != "open" {
		return models.GroupInfo{}, ErrApprovalRequired
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

func (r *GroupRepo) UpdateSettings(ctx context.Context, groupID, uid string, name, avatarURL, announcement *string, allow *bool, joinMode *string, allMuted *bool) error {
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
			name = COALESCE($2, name),
			avatar = COALESCE($3, avatar),
			announcement = COALESCE($4, announcement),
			allow_member_add_friend = COALESCE($5, allow_member_add_friend),
			join_mode = COALESCE($6, join_mode),
			all_muted = COALESCE($7, all_muted),
			updated_at = NOW()
		WHERE id=$1`, groupID, name, avatarURL, announcement, allow, joinMode, allMuted)
	if err != nil {
		return err
	}
	if r.LegacyChatEnabled && (name != nil || avatarURL != nil) {
		if _, err := tx.Exec(ctx, `
			UPDATE conversations c SET title=COALESCE($2,c.title), avatar=COALESCE($3,c.avatar)
			FROM groups g WHERE g.id=$1 AND c.id=g.conversation_id`, groupID, name, avatarURL); err != nil {
			return err
		}
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupUpdated, map[string]any{}); err != nil {
		return err
	}
	// 全员禁言在 OpenIM 侧是独立能力，改这个字段要额外发一次同步
	if allMuted != nil {
		if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMute, map[string]any{
			"muted": *allMuted,
		}); err != nil {
			return err
		}
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
		SELECT u.id::text, u.nickname, gm.nickname, u.avatar, COALESCE(u.status,'active'), gm.role, gm.muted_until
		FROM group_members gm JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid
		ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`, groupID)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var member models.IMGroupSyncMember
		if err := rows.Scan(&member.ID, &member.Nickname, &member.GroupNickname, &member.Avatar, &member.Status, &member.Role, &member.MutedUntil); err != nil {
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

var ErrApprovalRequired = errors.New("group approval required")

func (r *GroupRepo) EnsureQRCode(ctx context.Context, groupID, uid string) (models.GroupQRCodeResult, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.GroupQRCodeResult{}, err
	}
	defer tx.Rollback(ctx)
	// 同一群并发首次打开二维码页时只生成一个有效 token。
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, groupID); err != nil {
		return models.GroupQRCodeResult{}, err
	}
	var active bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
			WHERE gm.group_id=$1::uuid AND gm.user_id=$2::uuid AND g.status='active')`,
		groupID, uid).Scan(&active)
	if err != nil {
		return models.GroupQRCodeResult{}, err
	}
	if !active {
		return models.GroupQRCodeResult{}, ErrForbidden
	}
	var token string
	var expiresAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT token, expires_at FROM group_qrcodes
		WHERE group_id=$1::uuid AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY created_at DESC LIMIT 1`, groupID).Scan(&token, &expiresAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return models.GroupQRCodeResult{}, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		token = uuid.NewString()
		exp := time.Now().Add(365 * 24 * time.Hour)
		expiresAt = &exp
		if _, err := tx.Exec(ctx, `
			INSERT INTO group_qrcodes(group_id, token, expires_at) VALUES($1::uuid,$2,$3)`,
			groupID, token, exp); err != nil {
			return models.GroupQRCodeResult{}, err
		}
	}
	payload, _ := json.Marshal(map[string]string{"type": "group", "token": token})
	expStr := ""
	if expiresAt != nil {
		expStr = expiresAt.UTC().Format(time.RFC3339)
	}
	if err := tx.Commit(ctx); err != nil {
		return models.GroupQRCodeResult{}, err
	}
	return models.GroupQRCodeResult{
		GroupID:   groupID,
		Payload:   string(payload),
		ExpiresAt: expStr,
	}, nil
}

func (r *GroupRepo) ResolveQRCode(ctx context.Context, uid, token string) (models.GroupQRCodeResolveResult, error) {
	var groupID, joinMode string
	err := r.DB.QueryRow(ctx, `
		SELECT q.group_id::text, g.join_mode
		FROM group_qrcodes q JOIN groups g ON g.id=q.group_id
		WHERE q.token=$1 AND q.revoked_at IS NULL
		  AND (q.expires_at IS NULL OR q.expires_at > NOW())
		  AND g.status='active'`, token).Scan(&groupID, &joinMode)
	if err != nil {
		return models.GroupQRCodeResolveResult{}, err
	}
	g, err := r.GetByIDPublic(ctx, groupID)
	if err != nil {
		return models.GroupQRCodeResolveResult{}, err
	}
	var joined bool
	_ = r.DB.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1::uuid AND user_id=$2::uuid)`,
		groupID, uid).Scan(&joined)
	nextAction := "join"
	if joined {
		nextAction = "enter"
	} else if joinMode == "approval" {
		nextAction = "apply"
	}
	return models.GroupQRCodeResolveResult{
		Group: g, Joined: joined, JoinMode: joinMode, NextAction: nextAction,
	}, nil
}

func (r *GroupRepo) JoinByQRCode(ctx context.Context, uid, token, remark string) (models.JoinGroupByQRCodeResult, error) {
	resolved, err := r.ResolveQRCode(ctx, uid, token)
	if err != nil {
		return models.JoinGroupByQRCodeResult{}, err
	}
	groupID, err := r.InternalIDByPublicID(ctx, resolved.Group.ID)
	if err != nil {
		return models.JoinGroupByQRCodeResult{}, err
	}
	if resolved.Joined {
		group, err := r.GetByID(ctx, groupID, uid)
		if err != nil {
			return models.JoinGroupByQRCodeResult{}, err
		}
		return models.JoinGroupByQRCodeResult{Action: "enter", Group: group}, nil
	}
	if resolved.JoinMode == "open" {
		group, err := r.addMember(ctx, groupID, uid, true)
		if errors.Is(err, ErrApprovalRequired) {
			request, requestErr := r.CreateJoinRequest(ctx, groupID, uid, remark)
			if requestErr != nil {
				return models.JoinGroupByQRCodeResult{}, requestErr
			}
			resolved.Group.JoinMode = "approval"
			return models.JoinGroupByQRCodeResult{
				Action: "pending_approval", Group: resolved.Group, RequestID: request.ID,
			}, nil
		}
		if err != nil {
			return models.JoinGroupByQRCodeResult{}, err
		}
		return models.JoinGroupByQRCodeResult{Action: "joined", Group: group}, nil
	}
	request, err := r.CreateJoinRequest(ctx, groupID, uid, remark)
	if err != nil {
		// 群在解析后从审核切换为公开，或用户刚被其他管理员加入时，
		// 重新按当前加群模式原子判断，避免把有效二维码误报为失效。
		if errors.Is(err, pgx.ErrNoRows) {
			group, joinErr := r.addMember(ctx, groupID, uid, true)
			if joinErr == nil {
				return models.JoinGroupByQRCodeResult{Action: "joined", Group: group}, nil
			}
		}
		return models.JoinGroupByQRCodeResult{}, err
	}
	return models.JoinGroupByQRCodeResult{
		Action: "pending_approval", Group: resolved.Group, RequestID: request.ID,
	}, nil
}

func (r *GroupRepo) GetByIDPublic(ctx context.Context, groupID string) (models.GroupInfo, error) {
	var g models.GroupInfo
	var allow bool
	err := r.DB.QueryRow(ctx, `
		SELECT g.public_id, g.name, g.avatar, g.owner_id::text,
			(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
			g.announcement, g.allow_member_add_friend, COALESCE(g.conversation_id::text,''),
			g.join_mode, g.all_muted
		FROM groups g
		WHERE g.id=$1::uuid AND COALESCE(g.status,'active')='active'`, groupID,
	).Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount,
		&g.Announcement, &allow, &g.ConversationID, &g.JoinMode, &g.AllMuted)
	g.AllowMemberAddFriend = allow
	return g, err
}

func (r *GroupRepo) memberRole(ctx context.Context, groupID, uid string) (string, error) {
	var role string
	err := r.DB.QueryRow(ctx, `
		SELECT role FROM group_members WHERE group_id=$1::uuid AND user_id=$2::uuid`,
		groupID, uid).Scan(&role)
	return role, err
}

func (r *GroupRepo) InviteMembers(ctx context.Context, groupID, uid string, userIDs []string) (int, error) {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || (role != "owner" && role != "admin") {
		return 0, ErrForbidden
	}
	var convID string
	if err := r.DB.QueryRow(ctx, `SELECT conversation_id::text FROM groups WHERE id=$1`, groupID).Scan(&convID); err != nil {
		return 0, err
	}
	count := 0
	for _, inviteeID := range userIDs {
		if inviteeID == uid {
			continue
		}
		var exists bool
		_ = r.DB.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2)`,
			groupID, inviteeID).Scan(&exists)
		if exists {
			continue
		}
		token := uuid.NewString()
		_, err := r.DB.Exec(ctx, `
			INSERT INTO group_invitations(group_id, inviter_id, invitee_id, token, status)
			VALUES($1::uuid,$2::uuid,$3::uuid,$4,'pending')`, groupID, uid, inviteeID, token)
		if err != nil {
			continue
		}
		count++
	}
	return count, nil
}

func (r *GroupRepo) AcceptInvitation(ctx context.Context, uid, token string) (models.GroupInfo, error) {
	var groupID string
	err := r.DB.QueryRow(ctx, `
		UPDATE group_invitations SET status='accepted', handled_at=NOW()
		WHERE token=$1 AND invitee_id=$2::uuid AND status='pending'
		RETURNING group_id::text`, token, uid).Scan(&groupID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	return r.addMember(ctx, groupID, uid, false)
}

func (r *GroupRepo) UpdateMyNickname(ctx context.Context, groupID, uid, nickname string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		UPDATE group_members gm SET nickname=$3
		FROM groups g
		WHERE gm.group_id=$1::uuid AND gm.user_id=$2::uuid
		  AND g.id=gm.group_id AND g.status='active'`, groupID, uid, nickname)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrForbidden
	}
	if err := EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMemberProfile, map[string]any{
		"userId": uid,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *GroupRepo) CreateReport(ctx context.Context, groupID, uid, reason, description string) (models.GroupReportResult, error) {
	var result models.GroupReportResult
	var createdAt time.Time
	err := r.DB.QueryRow(ctx, `
		INSERT INTO group_reports(group_id, reporter_id, reason, description)
		SELECT $1::uuid,$2::uuid,$3,$4
		WHERE EXISTS(
			SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
			WHERE gm.group_id=$1::uuid AND gm.user_id=$2::uuid AND g.status='active')
		ON CONFLICT (group_id, reporter_id) WHERE status='pending'
		DO UPDATE SET reason=EXCLUDED.reason, description=EXCLUDED.description, updated_at=NOW()
		RETURNING id::text, status, created_at`, groupID, uid, reason, description,
	).Scan(&result.ID, &result.Status, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, ErrForbidden
	}
	result.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return result, err
}

func (r *GroupRepo) CreateJoinRequest(ctx context.Context, groupID, uid, remark string) (models.GroupJoinRequestItem, error) {
	var id string
	var createdAt time.Time
	err := r.DB.QueryRow(ctx, `
		INSERT INTO group_join_requests(group_id, user_id, remark, status)
		SELECT $1::uuid,$2::uuid,$3,'pending'
		WHERE EXISTS(SELECT 1 FROM groups WHERE id=$1::uuid AND status='active' AND join_mode='approval')
		  AND NOT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1::uuid AND user_id=$2::uuid)
		ON CONFLICT (group_id, user_id) WHERE status='pending'
		DO UPDATE SET remark=EXCLUDED.remark
		RETURNING id::text, created_at`, groupID, uid, remark).Scan(&id, &createdAt)
	if err != nil {
		return models.GroupJoinRequestItem{}, err
	}
	u, _ := r.userSummary(ctx, uid)
	return models.GroupJoinRequestItem{
		ID: id, Status: "pending", Remark: remark,
		CreatedAt: createdAt.UTC().Format(time.RFC3339),
		Applicant: u,
	}, nil
}

func (r *GroupRepo) ListJoinRequests(ctx context.Context, groupID, uid string) ([]models.GroupJoinRequestItem, error) {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || (role != "owner" && role != "admin") {
		return nil, ErrForbidden
	}
	rows, err := r.DB.Query(ctx, `
		SELECT jr.id::text, jr.status, jr.remark, jr.created_at,
			u.id::text, COALESCE(u.public_id,''), u.nickname, u.avatar
		FROM group_join_requests jr
		JOIN users u ON u.id=jr.user_id
		WHERE jr.group_id=$1::uuid AND jr.status='pending'
		ORDER BY jr.created_at DESC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.GroupJoinRequestItem, 0)
	for rows.Next() {
		var item models.GroupJoinRequestItem
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.Status, &item.Remark, &createdAt,
			&item.Applicant.ID, &item.Applicant.PublicID, &item.Applicant.Nickname, &item.Applicant.Avatar); err != nil {
			return nil, err
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		list = append(list, item)
	}
	return list, nil
}

func (r *GroupRepo) ApproveJoinRequest(ctx context.Context, groupID, uid, requestID string) (models.GroupInfo, error) {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || (role != "owner" && role != "admin") {
		return models.GroupInfo{}, ErrForbidden
	}
	var applicantID string
	err = r.DB.QueryRow(ctx, `
		UPDATE group_join_requests SET status='approved', handler_id=$3::uuid, handled_at=NOW()
		WHERE id=$1::uuid AND group_id=$2::uuid AND status='pending'
		RETURNING user_id::text`, requestID, groupID, uid).Scan(&applicantID)
	if err != nil {
		return models.GroupInfo{}, err
	}
	return r.addMember(ctx, groupID, applicantID, false)
}

func (r *GroupRepo) RejectJoinRequest(ctx context.Context, groupID, uid, requestID string) error {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || (role != "owner" && role != "admin") {
		return ErrForbidden
	}
	tag, err := r.DB.Exec(ctx, `
		UPDATE group_join_requests SET status='rejected', handler_id=$3::uuid, handled_at=NOW()
		WHERE id=$1::uuid AND group_id=$2::uuid AND status='pending'`,
		requestID, groupID, uid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not found")
	}
	return nil
}

func (r *GroupRepo) RemoveMember(ctx context.Context, groupID, uid, targetID string) error {
	actorRole, err := r.memberRole(ctx, groupID, uid)
	if err != nil {
		return ErrForbidden
	}
	targetRole, err := r.memberRole(ctx, groupID, targetID)
	if err != nil {
		return errors.New("not found")
	}
	if targetRole == "owner" {
		return ErrForbidden
	}
	if actorRole != "owner" && actorRole != "admin" {
		return ErrForbidden
	}
	if actorRole == "admin" && targetRole == "admin" {
		return ErrForbidden
	}
	return r.Leave(ctx, groupID, targetID)
}

func (r *GroupRepo) userSummary(ctx context.Context, uid string) (models.UserSummary, error) {
	var u models.UserSummary
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, COALESCE(public_id,''), nickname, avatar FROM users WHERE id=$1::uuid`, uid,
	).Scan(&u.ID, &u.PublicID, &u.Nickname, &u.Avatar)
	return u, err
}
