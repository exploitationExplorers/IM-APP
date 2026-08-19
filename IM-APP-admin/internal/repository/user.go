package repository

import (
	"context"
	"time"

	"im-app-admin/internal/models"
	"im-app-admin/internal/util"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DataRepo 用户/群组/举报业务数据（复用 APP 表 + 后台新表）
type DataRepo struct{ DB *pgxpool.Pool }

// ===== 用户管理（清单 03） =====

const userSelect = `
	SELECT u.id::text, COALESCE(u.public_id,''), COALESCE(u.phone_e164,''), u.country_code, u.nickname, u.avatar,
	       COALESCE(u.status,'active'), u.created_at,
	       (SELECT COUNT(*) FROM friendships f WHERE f.user_id=u.id),
	       (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id=u.id),
	       COALESCE((SELECT ur.banned FROM user_restrictions ur WHERE ur.user_id=u.id AND ur.type='login'), false),
	       COALESCE((SELECT ur.banned FROM user_restrictions ur WHERE ur.user_id=u.id AND ur.type='message'), false),
	       (SELECT COUNT(*) FROM reports rp WHERE rp.target_id=u.id::text AND rp.target_type='user')
	FROM users u`

func scanUser(row pgx.Row) (models.AppUser, error) {
	var u models.AppUser
	err := row.Scan(&u.ID, &u.PublicID, &u.PhoneMasked, &u.CountryCode, &u.Nickname, &u.Avatar,
		&u.Status, &u.CreatedAt, &u.FriendCount, &u.GroupCount, &u.LoginBanned, &u.MessageBanned, &u.ReportCount)
	if err != nil {
		return u, err
	}
	u.PhoneMasked = util.MaskPhone(u.PhoneMasked)
	return u, nil
}

// ListUsers 用户列表（关键字 + 状态筛选；手机号走独立 SearchByPhone 权限）
func (r *DataRepo) ListUsers(ctx context.Context, keyword, status string, limit, offset int) ([]models.AppUser, int64, error) {
	where, args := userWhere(keyword, status)
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM users u WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, userSelect+" WHERE 1=1"+where+
		" ORDER BY u.created_at DESC LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.AppUser, 0)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, u)
	}
	return out, total, nil
}

// SearchByPhone 按手机号查询用户（需 users.phone.search 权限，保护隐私）
func (r *DataRepo) SearchByPhone(ctx context.Context, phone string, limit, offset int) ([]models.AppUser, int64, error) {
	args := []any{"%" + phone + "%"}
	where := " AND u.phone_e164 ILIKE $1"
	var total int64
	if err := r.DB.QueryRow(ctx, "SELECT COUNT(*) FROM users u WHERE 1=1"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	qargs := append(append([]any{}, args...), limit, offset)
	rows, err := r.DB.Query(ctx, userSelect+" WHERE 1=1"+where+
		" ORDER BY u.created_at DESC LIMIT $"+itoa(len(qargs)-1)+" OFFSET $"+itoa(len(qargs)), qargs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.AppUser, 0)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, u)
	}
	return out, total, nil
}

func userWhere(keyword, status string) (string, []any) {
	w := ""
	args := make([]any, 0)
	if keyword != "" {
		args = append(args, "%"+keyword+"%")
		w += " AND (u.nickname ILIKE $" + itoa(len(args)) +
			" OR u.public_id ILIKE $" + itoa(len(args)) +
			" OR u.id::text=$" + itoa(len(args)) + ")"
	}
	if status != "" {
		args = append(args, status)
		w += " AND u.status=$" + itoa(len(args))
	}
	return w, args
}

func (r *DataRepo) GetUserDetail(ctx context.Context, userID string) (*models.AppUserDetail, error) {
	u, err := scanUser(r.DB.QueryRow(ctx, userSelect+" WHERE u.id=$1::uuid", userID))
	if err != nil {
		return nil, err
	}
	d := &models.AppUserDetail{AppUser: u}
	if err := r.DB.QueryRow(ctx, `SELECT COALESCE(bio,'') FROM users WHERE id=$1::uuid`, userID).Scan(&d.Bio); err != nil {
		return nil, err
	}
	rows, err := r.DB.Query(ctx, `SELECT g.id::text FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=$1::uuid`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var gid string
			if rows.Scan(&gid) == nil {
				d.GroupIDs = append(d.GroupIDs, gid)
			}
		}
	}
	return d, nil
}

// RevealPhone 查看完整手机号（仅 phone.reveal 权限 + 原因/工单 + 审计后调用）
func (r *DataRepo) RevealPhone(ctx context.Context, userID string) (string, error) {
	var phone string
	err := r.DB.QueryRow(ctx, `SELECT phone_e164 FROM users WHERE id=$1::uuid`, userID).Scan(&phone)
	return phone, err
}

func (r *DataRepo) ListUserGroups(ctx context.Context, userID string) ([]models.AppGroup, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT g.id::text, g.name, g.avatar, g.owner_id::text, COALESCE(ou.nickname,''),
		       (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id=g.id),
		       COALESCE(g.status,'active'), COALESCE(g.all_muted,false), g.created_at
		FROM group_members gm JOIN groups g ON g.id=gm.group_id
		LEFT JOIN users ou ON ou.id=g.owner_id
		WHERE gm.user_id=$1::uuid`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.AppGroup, 0)
	for rows.Next() {
		var g models.AppGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Avatar, &g.OwnerID, &g.OwnerName,
			&g.MemberCount, &g.Status, &g.AllMuted, &g.CreatedAt); err != nil {
			return nil, err
		}
		g.Status = normalizeGroupStatus(g.Status)
		out = append(out, g)
	}
	return out, nil
}

// SetRestriction 设置登录/发信限制（UPSERT user_restrictions，不动 users 表）
func (r *DataRepo) SetRestriction(ctx context.Context, userID, restrType string, banned bool, until *time.Time, reason, operatorID string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO user_restrictions(user_id, type, banned, until, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5,$6::uuid)
		ON CONFLICT (user_id, type) DO UPDATE SET
			banned=$3, until=$4, reason=$5, operator_id=$6::uuid, created_at=NOW()`,
		userID, restrType, banned, until, reason, operatorID)
	return err
}

// UpdateUserStatus 更新账号状态（active|banned|cancelled），记录 user_status_logs；
// banned 时撤销全部登录会话（清单 03.3）
func (r *DataRepo) UpdateUserStatus(ctx context.Context, userID, status, reason, operatorID string) error {
	var oldStatus string
	if err := r.DB.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM users WHERE id=$1::uuid`, userID).Scan(&oldStatus); err != nil {
		return err
	}
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE users SET status=$2, updated_at=NOW() WHERE id=$1::uuid`, userID, status); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_status_logs(user_id, from_status, to_status, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5::uuid)`, userID, oldStatus, status, reason, operatorID); err != nil {
		return err
	}
	if status == "banned" {
		if _, err := tx.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// RevokeUserSessions 强制用户全部设备下线（清单 03）
func (r *DataRepo) RevokeUserSessions(ctx context.Context, userID string) error {
	_, err := r.DB.Exec(ctx, `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1::uuid AND revoked_at IS NULL`, userID)
	return err
}

// LogUserStatusChange 记录用户状态变更审计（状态变更已由 server 内部接口执行；本方法只写 user_status_logs）
func (r *DataRepo) LogUserStatusChange(ctx context.Context, userID, toStatus, reason, operatorID string) error {
	var oldStatus string
	if err := r.DB.QueryRow(ctx, `SELECT COALESCE(status,'active') FROM users WHERE id=$1::uuid`, userID).Scan(&oldStatus); err != nil {
		return err
	}
	_, err := r.DB.Exec(ctx, `
		INSERT INTO user_status_logs(user_id, from_status, to_status, reason, operator_id)
		VALUES($1::uuid,$2,$3,$4,$5::uuid)`, userID, oldStatus, toStatus, reason, operatorID)
	return err
}

// ListUserForwardTasks 用户转发记录（清单 03）
func (r *DataRepo) ListUserForwardTasks(ctx context.Context, userID string, limit, offset int) ([]models.ForwardTask, int64, error) {
	var total int64
	_ = r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM forward_tasks WHERE user_id=$1::uuid`, userID).Scan(&total)
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, user_id::text, status, target_count, done_count, created_at, updated_at
		FROM forward_tasks WHERE user_id=$1::uuid ORDER BY created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.ForwardTask, 0)
	for rows.Next() {
		var t models.ForwardTask
		var done int64
		if err := rows.Scan(&t.ID, &t.UserID, &t.Status, &t.TargetCount, &done, &t.CreatedAt, &t.FinishedAt); err != nil {
			return nil, 0, err
		}
		t.SuccessCount = done
		out = append(out, t)
	}
	return out, total, nil
}
