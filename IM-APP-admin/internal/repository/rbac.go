package repository

import (
	"context"
	"errors"

	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrRoleInUse 角色仍被管理员引用，不允许删除
var ErrRoleInUse = errors.New("角色已被管理员使用，不能删除")

// RBACRepo 管理员账号/角色/权限（表：admin_users/admin_roles/admin_permissions/...）
type RBACRepo struct{ DB *pgxpool.Pool }

// ===== 管理员账号 =====

func (r *RBACRepo) ListAdmins(ctx context.Context, keyword string, limit, offset int) ([]models.AdminAccount, int64, error) {
	var total int64
	if err := r.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM admin_users
		WHERE $1='' OR username ILIKE '%'||$1||'%' OR nickname ILIKE '%'||$1||'%'`, keyword).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.DB.Query(ctx, `
		SELECT u.id::text, u.username, u.nickname, u.status, u.last_login_at, u.created_at
		FROM admin_users u
		WHERE $1='' OR u.username ILIKE '%'||$1||'%' OR u.nickname ILIKE '%'||$1||'%'
		ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`, keyword, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.AdminAccount, 0)
	for rows.Next() {
		var a models.AdminAccount
		if err := rows.Scan(&a.ID, &a.Username, &a.Nickname, &a.Status, &a.LastLoginAt, &a.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, a)
	}
	return out, total, nil
}

// FillRoles 批量填充管理员的角色名与角色 ID（循环查，管理员数量有限）
func (r *RBACRepo) FillRoles(ctx context.Context, accounts []models.AdminAccount) []models.AdminAccount {
	for i := range accounts {
		names, _ := r.roleNames(ctx, accounts[i].ID)
		ids, _ := r.roleIDs(ctx, accounts[i].ID)
		accounts[i].RoleNames = names
		accounts[i].RoleIDs = ids
	}
	return accounts
}

func (r *RBACRepo) roleNames(ctx context.Context, adminID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT ro.name FROM admin_user_roles ur JOIN admin_roles ro ON ro.id=ur.role_id
		WHERE ur.admin_id=$1::uuid`, adminID)
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

func (r *RBACRepo) roleIDs(ctx context.Context, adminID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `SELECT role_id::text FROM admin_user_roles WHERE admin_id=$1::uuid`, adminID)
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

func (r *RBACRepo) CreateAdmin(ctx context.Context, req models.AdminCreateRequest, pwdHash string) (string, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var id string
	status := req.Status
	if status == "" {
		status = "active"
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO admin_users(username, password_hash, nickname, status)
		VALUES($1,$2,$3,$4) RETURNING id::text`,
		req.Username, pwdHash, req.Nickname, status).Scan(&id)
	if err != nil {
		return "", err
	}
	if err := r.setUserRolesTx(ctx, tx, id, req.RoleIDs); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (r *RBACRepo) UpdateAdmin(ctx context.Context, id string, req models.AdminUpdateRequest, newPwdHash string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE admin_users SET
			nickname = COALESCE(NULLIF($2,''), nickname),
			status   = COALESCE(NULLIF($3,''), status),
			password_hash = COALESCE(NULLIF($4,''), password_hash),
			updated_at = NOW()
		WHERE id=$1::uuid`, id, req.Nickname, req.Status, newPwdHash); err != nil {
		return err
	}
	if req.RoleIDs != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM admin_user_roles WHERE admin_id=$1::uuid`, id); err != nil {
			return err
		}
		if err := r.setUserRolesTx(ctx, tx, id, req.RoleIDs); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// setUserRolesTx 事务内设置管理员角色关联
func (r *RBACRepo) setUserRolesTx(ctx context.Context, tx pgx.Tx, adminID string, roleIDs []string) error {
	for _, rid := range roleIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO admin_user_roles(admin_id, role_id) VALUES($1,$2::uuid)
			ON CONFLICT DO NOTHING`, adminID, rid); err != nil {
			return err
		}
	}
	return nil
}

func (r *RBACRepo) UpdateAdminStatus(ctx context.Context, id, status string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admin_users SET status=$2, updated_at=NOW() WHERE id=$1::uuid`, id, status)
	return err
}

// ===== 角色 =====

func (r *RBACRepo) ListRoles(ctx context.Context) ([]models.AdminRole, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT r.id::text, r.name, r.code, r.description, r.status, r.created_at,
		       (SELECT COUNT(*) FROM admin_user_roles ur WHERE ur.role_id=r.id)
		FROM admin_roles r ORDER BY r.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.AdminRole, 0)
	for rows.Next() {
		var ro models.AdminRole
		if err := rows.Scan(&ro.ID, &ro.Name, &ro.Code, &ro.Description, &ro.Status, &ro.CreatedAt, &ro.UserCount); err != nil {
			return nil, err
		}
		out = append(out, ro)
	}
	return out, nil
}

func (r *RBACRepo) GetRole(ctx context.Context, id string) (*models.AdminRole, error) {
	var ro models.AdminRole
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, name, code, description, status, created_at FROM admin_roles WHERE id=$1::uuid`, id,
	).Scan(&ro.ID, &ro.Name, &ro.Code, &ro.Description, &ro.Status, &ro.CreatedAt)
	if err != nil {
		return nil, err
	}
	perms, _ := r.GetRolePermissions(ctx, ro.ID)
	ro.Permissions = perms
	return &ro, nil
}

func (r *RBACRepo) CreateRole(ctx context.Context, req models.RoleCreateRequest) (string, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO admin_roles(name, code, description) VALUES($1,$2,$3) RETURNING id::text`,
		req.Name, req.Code, req.Description).Scan(&id); err != nil {
		return "", err
	}
	if err := r.setRolePermsTx(ctx, tx, id, req.Permissions); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (r *RBACRepo) UpdateRole(ctx context.Context, id string, req models.RoleUpdateRequest) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE admin_roles SET
			name        = COALESCE(NULLIF($2,''), name),
			description = COALESCE(NULLIF($3,''), description),
			status      = COALESCE(NULLIF($4,''), status)
		WHERE id=$1::uuid`, id, req.Name, req.Description, req.Status); err != nil {
		return err
	}
	if req.Permissions != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM admin_role_permissions WHERE role_id=$1::uuid`, id); err != nil {
			return err
		}
		if err := r.setRolePermsTx(ctx, tx, id, req.Permissions); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// setRolePermsTx 事务内按权限码设置角色权限
func (r *RBACRepo) setRolePermsTx(ctx context.Context, tx pgx.Tx, roleID string, perms []string) error {
	for _, code := range perms {
		var pid string
		err := tx.QueryRow(ctx, `SELECT id::text FROM admin_permissions WHERE code=$1`, code).Scan(&pid)
		if err == pgx.ErrNoRows {
			continue // 未知权限码跳过
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO admin_role_permissions(role_id, permission_id) VALUES($1::uuid,$2::uuid)
			ON CONFLICT DO NOTHING`, roleID, pid); err != nil {
			return err
		}
	}
	return nil
}

func (r *RBACRepo) DeleteRole(ctx context.Context, id string) (int64, error) {
	// 被管理员引用时拒绝删除，避免 ON DELETE CASCADE 静默清空引用方权限
	var refs int64
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM admin_user_roles WHERE role_id=$1::uuid`, id).Scan(&refs); err != nil {
		return 0, err
	}
	if refs > 0 {
		return 0, ErrRoleInUse
	}
	// 返回受影响行数，判断角色是否不存在
	tag, err := r.DB.Exec(ctx, `DELETE FROM admin_roles WHERE id=$1::uuid AND code<>'super_admin'`, id)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RoleCodeByID 查询角色 code（用于 super_admin 角色分配校验）
func (r *RBACRepo) RoleCodeByID(ctx context.Context, roleID string) (string, error) {
	var code string
	err := r.DB.QueryRow(ctx, `SELECT code FROM admin_roles WHERE id=$1::uuid`, roleID).Scan(&code)
	return code, err
}

func (r *RBACRepo) GetRolePermissions(ctx context.Context, roleID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT p.code FROM admin_role_permissions rp
		JOIN admin_permissions p ON p.id = rp.permission_id
		WHERE rp.role_id=$1::uuid ORDER BY p.module, p.code`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, nil
}

func (r *RBACRepo) ListPermissions(ctx context.Context) ([]models.AdminPermission, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT id::text, code, name, module, description FROM admin_permissions ORDER BY module, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.AdminPermission, 0)
	for rows.Next() {
		var p models.AdminPermission
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.Module, &p.Description); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ===== 权限校验（实现 middleware.PermissionChecker） =====

// IsSuperAdmin 超级管理员（super_admin 角色）放行所有
func (r *RBACRepo) IsSuperAdmin(ctx context.Context, adminID string) (bool, error) {
	var one int
	err := r.DB.QueryRow(ctx, `
		SELECT 1 FROM admin_user_roles ur
		JOIN admin_roles ro ON ro.id = ur.role_id
		WHERE ur.admin_id=$1::uuid AND ro.code='super_admin' AND ro.status='active'`, adminID).Scan(&one)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// HasPermission 校验管理员是否拥有权限点
func (r *RBACRepo) HasPermission(ctx context.Context, adminID, permission string) (bool, error) {
	var one int
	err := r.DB.QueryRow(ctx, `
		SELECT 1 FROM admin_role_permissions rp
		JOIN admin_user_roles ur ON ur.role_id = rp.role_id
		JOIN admin_roles ro ON ro.id = ur.role_id AND ro.status='active'
		JOIN admin_permissions p ON p.id = rp.permission_id
		WHERE ur.admin_id=$1::uuid AND p.code=$2`, adminID, permission).Scan(&one)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// ===== 初始化 =====

// BootstrapAdmin 一次性初始化超级管理员角色与账号（密码来自 env，不写死演示密码）
func (r *RBACRepo) BootstrapAdmin(ctx context.Context, username, pwdHash string) error {
	var roleID string
	err := r.DB.QueryRow(ctx, `SELECT id::text FROM admin_roles WHERE code='super_admin'`).Scan(&roleID)
	if err == pgx.ErrNoRows {
		if err := r.DB.QueryRow(ctx, `
			INSERT INTO admin_roles(name, code, description, status)
			VALUES('超级管理员','super_admin','内置超级管理员，拥有全部权限','active')
			RETURNING id::text`).Scan(&roleID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	var cnt int
	if err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM admin_users`).Scan(&cnt); err != nil {
		return err
	}
	if cnt > 0 {
		return nil // 已有管理员，跳过
	}
	if pwdHash == "" {
		return nil // 未配置初始化密码，不创建
	}
	var adminID string
	if err := r.DB.QueryRow(ctx, `
		INSERT INTO admin_users(username, password_hash, nickname, status)
		VALUES($1,$2,'超级管理员','active') RETURNING id::text`, username, pwdHash).Scan(&adminID); err != nil {
		return err
	}
	_, err = r.DB.Exec(ctx, `
		INSERT INTO admin_user_roles(admin_id, role_id) VALUES($1::uuid,$2::uuid)`, adminID, roleID)
	return err
}
