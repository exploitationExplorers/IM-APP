package repository

import (
	"context"
	"errors"
	"time"

	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuthRepo 管理员认证与会话（表：admin_users/admin_sessions/admin_login_logs）
type AuthRepo struct{ DB *pgxpool.Pool }

// FindByUsername 登录查询：返回管理员信息与密码哈希
func (r *AuthRepo) FindByUsername(ctx context.Context, username string) (*models.AdminAccount, string, error) {
	var a models.AdminAccount
	var pwd string
	var mfa string
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, username, nickname, status, COALESCE(mfa_secret,''), last_login_at, created_at
		FROM admin_users WHERE username=$1`, username,
	).Scan(&a.ID, &a.Username, &a.Nickname, &a.Status, &mfa, &a.LastLoginAt, &a.CreatedAt)
	if err != nil {
		return nil, "", err
	}
	a.MFAEnabled = mfa != ""
	if roles, err := r.rolesByAdmin(ctx, a.ID); err == nil {
		a.RoleNames = roles
	}
	_ = r.DB.QueryRow(ctx, `SELECT password_hash FROM admin_users WHERE id=$1::uuid`, a.ID).Scan(&pwd)
	return &a, pwd, nil
}

func (r *AuthRepo) FindByID(ctx context.Context, id string) (*models.AdminAccount, error) {
	var a models.AdminAccount
	var mfa string
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, username, nickname, status, COALESCE(mfa_secret,''), last_login_at, created_at
		FROM admin_users WHERE id=$1::uuid`, id,
	).Scan(&a.ID, &a.Username, &a.Nickname, &a.Status, &mfa, &a.LastLoginAt, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	a.MFAEnabled = mfa != ""
	if roles, err := r.rolesByAdmin(ctx, a.ID); err == nil {
		a.RoleNames = roles
	}
	return &a, nil
}

func (r *AuthRepo) rolesByAdmin(ctx context.Context, adminID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT ro.name FROM admin_user_roles ur
		JOIN admin_roles ro ON ro.id = ur.role_id
		WHERE ur.admin_id=$1::uuid ORDER BY ro.created_at`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

// roleIDsByAdmin 返回管理员的角色 ID 列表
func (r *AuthRepo) roleIDsByAdmin(ctx context.Context, adminID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT role_id::text FROM admin_user_roles WHERE admin_id=$1::uuid`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// RoleIDs 返回管理员的角色 ID 列表
func (r *AuthRepo) RoleIDs(ctx context.Context, adminID string) ([]string, error) {
	return r.roleIDsByAdmin(ctx, adminID)
}

func (r *AuthRepo) UpdateLastLogin(ctx context.Context, id string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admin_users SET last_login_at=NOW() WHERE id=$1::uuid`, id)
	return err
}

// UpdatePassword 修改本人密码
func (r *AuthRepo) UpdatePassword(ctx context.Context, id, pwdHash string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admin_users SET password_hash=$2, updated_at=NOW() WHERE id=$1::uuid`, id, pwdHash)
	return err
}

// GetMFA 返回 MFA 密钥与是否启用
func (r *AuthRepo) GetMFA(ctx context.Context, id string) (string, error) {
	var secret string
	err := r.DB.QueryRow(ctx, `SELECT COALESCE(mfa_secret,'') FROM admin_users WHERE id=$1::uuid`, id).Scan(&secret)
	return secret, err
}

// SetMFA 设置/关闭 MFA 密钥
func (r *AuthRepo) SetMFA(ctx context.Context, id, secret string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admin_users SET mfa_secret=$2, updated_at=NOW() WHERE id=$1::uuid`, id, secret)
	return err
}

// ===== 会话 =====

func (r *AuthRepo) CreateSession(ctx context.Context, adminID, refreshHash, device, ip, ua string, expiresAt time.Time) (string, error) {
	var id string
	err := r.DB.QueryRow(ctx, `
		INSERT INTO admin_sessions(admin_id, refresh_token_hash, device, ip, user_agent, expires_at)
		VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
		adminID, refreshHash, device, ip, ua, expiresAt).Scan(&id)
	return id, err
}

// FindSessionByRefresh 按 refresh token 哈希查会话
func (r *AuthRepo) FindSessionByRefresh(ctx context.Context, refreshHash string) (*models.AdminSession, error) {
	var s models.AdminSession
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, admin_id::text, device, ip, user_agent, created_at, expires_at, revoked_at
		FROM admin_sessions WHERE refresh_token_hash=$1`, refreshHash,
	).Scan(&s.ID, &s.AdminID, &s.Device, &s.IP, &s.UserAgent, &s.CreatedAt, &s.ExpiresAt, &s.RevokedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *AuthRepo) RevokeSessionByID(ctx context.Context, id string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admin_sessions SET revoked_at=NOW() WHERE id=$1::uuid AND revoked_at IS NULL`, id)
	return err
}

// RevokeAllSessions 停用管理员后其全部会话立即失效（清单 01.3）
func (r *AuthRepo) RevokeAllSessions(ctx context.Context, adminID string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admin_sessions SET revoked_at=NOW() WHERE admin_id=$1::uuid AND revoked_at IS NULL`, adminID)
	return err
}

// ===== 登录日志 =====

func (r *AuthRepo) InsertLoginLog(ctx context.Context, adminID string, success bool, failReason, ip, ua, requestID string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO admin_login_logs(admin_id, success, fail_reason, ip, user_agent, request_id)
		VALUES($1,$2,$3,$4,$5,$6)`,
		nullableUUID(adminID), success, failReason, ip, ua, requestID)
	return err
}

func (r *AuthRepo) ListLoginLogs(ctx context.Context, limit, offset int) ([]models.LoginLog, int64, error) {
	var total int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM admin_login_logs`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT l.id, l.admin_id::text, COALESCE(a.nickname,''), l.success, l.fail_reason,
		       l.ip, l.user_agent, l.request_id, l.created_at
		FROM admin_login_logs l LEFT JOIN admin_users a ON a.id = l.admin_id
		ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.LoginLog, 0)
	for rows.Next() {
		var l models.LoginLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.AdminName, &l.Success, &l.FailReason,
			&l.IP, &l.UserAgent, &l.RequestID, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, l)
	}
	return out, total, nil
}

// nullableUUID 空串转 nil，避免 uuid 列插入空串报错
func nullableUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ErrNotFound 查询无结果
var ErrNotFound = errors.New("not found")

// isNoRows 判断 pgx 无结果
func isNoRows(err error) bool {
	return err == pgx.ErrNoRows
}
