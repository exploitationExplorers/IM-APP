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

func (r *GroupRepo) UpdateSettings(ctx context.Context, groupID, uid string, announcement *string, allow *bool, joinMode *string, allMuted *bool) error {
	var role string
	err := r.DB.QueryRow(ctx, `
		SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2`, groupID, uid).Scan(&role)
	if err != nil || (role != "owner" && role != "admin") {
		return ErrForbidden
	}
	_, err = r.DB.Exec(ctx, `
		UPDATE groups SET
			announcement = COALESCE($2, announcement),
			allow_member_add_friend = COALESCE($3, allow_member_add_friend),
			join_mode = COALESCE($4, join_mode),
			all_muted = COALESCE($5, all_muted)
		WHERE id=$1`, groupID, announcement, allow, joinMode, allMuted)
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

func (r *GroupRepo) EnsureQRCode(ctx context.Context, groupID, uid string) (models.GroupQRCodeResult, error) {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || (role != "owner" && role != "admin") {
		return models.GroupQRCodeResult{}, ErrForbidden
	}
	var token string
	var expiresAt *time.Time
	err = r.DB.QueryRow(ctx, `
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
		if _, err := r.DB.Exec(ctx, `
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
	return models.GroupQRCodeResult{
		GroupID:   groupID,
		Payload:   string(payload),
		ExpiresAt: expStr,
	}, nil
}

func (r *GroupRepo) ResolveQRCode(ctx context.Context, uid, token string) (models.GroupQRCodeResolveResult, error) {
	var groupID string
	err := r.DB.QueryRow(ctx, `
		SELECT group_id::text FROM group_qrcodes
		WHERE token=$1 AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())`, token).Scan(&groupID)
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
	return models.GroupQRCodeResolveResult{Group: g, Joined: joined}, nil
}

func (r *GroupRepo) GetByIDPublic(ctx context.Context, groupID string) (models.GroupInfo, error) {
	var g models.GroupInfo
	var allow bool
	err := r.DB.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.avatar, g.owner_id::text,
			(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
			g.announcement, g.allow_member_add_friend, COALESCE(g.conversation_id::text,'')
		FROM groups g
		WHERE g.id=$1::uuid AND COALESCE(g.status,'active')='active'`, groupID,
	).Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.MemberCount,
		&g.Announcement, &allow, &g.ConversationID)
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
	return r.Join(ctx, groupID, uid)
}

func (r *GroupRepo) CreateJoinRequest(ctx context.Context, groupID, uid, remark string) (models.GroupJoinRequestItem, error) {
	var id string
	var createdAt time.Time
	err := r.DB.QueryRow(ctx, `
		INSERT INTO group_join_requests(group_id, user_id, remark, status)
		VALUES($1::uuid,$2::uuid,$3,'pending')
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
	return r.Join(ctx, groupID, applicantID)
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

func (r *GroupRepo) UpdateMemberRole(ctx context.Context, groupID, uid, targetID, role string) error {
	ownerRole, err := r.memberRole(ctx, groupID, uid)
	if err != nil || ownerRole != "owner" {
		return ErrForbidden
	}
	if role != "admin" && role != "member" {
		return errors.New("invalid role")
	}
	tag, err := r.DB.Exec(ctx, `
		UPDATE group_members SET role=$3
		WHERE group_id=$1::uuid AND user_id=$2::uuid AND role <> 'owner'`,
		groupID, targetID, role)
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

func (r *GroupRepo) Dissolve(ctx context.Context, groupID, uid string) error {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || role != "owner" {
		return ErrForbidden
	}
	_, err = r.DB.Exec(ctx, `
		UPDATE groups SET status='dissolved' WHERE id=$1::uuid`, groupID)
	return err
}

func (r *GroupRepo) MuteMember(ctx context.Context, groupID, uid, targetID string, until *time.Time) error {
	role, err := r.memberRole(ctx, groupID, uid)
	if err != nil || (role != "owner" && role != "admin") {
		return ErrForbidden
	}
	tag, err := r.DB.Exec(ctx, `
		UPDATE group_members SET muted_until=$3
		WHERE group_id=$1::uuid AND user_id=$2::uuid AND role <> 'owner'`,
		groupID, targetID, until)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("not found")
	}
	return nil
}

func (r *GroupRepo) userSummary(ctx context.Context, uid string) (models.UserSummary, error) {
	var u models.UserSummary
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, COALESCE(public_id,''), nickname, avatar FROM users WHERE id=$1::uuid`, uid,
	).Scan(&u.ID, &u.PublicID, &u.Nickname, &u.Avatar)
	return u, err
}
