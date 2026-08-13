package repository

import (
	"context"

	"im-app-admin/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type AdminRepo struct{ DB *pgxpool.Pool }

// FindByUsername 登录查询，返回管理员信息和密码哈希
func (r *AdminRepo) FindByUsername(ctx context.Context, username string) (models.Admin, string, error) {
	var a models.Admin
	var pwd string
	err := r.DB.QueryRow(ctx, `
		SELECT a.id::text, a.username, a.nickname, COALESCE(a.role_id::text,''), COALESCE(ro.name,''),
		       a.status, a.last_login_at, a.created_at, a.password_hash
		FROM admins a LEFT JOIN roles ro ON ro.id = a.role_id
		WHERE a.username=$1`, username,
	).Scan(&a.ID, &a.Username, &a.Nickname, &a.RoleID, &a.RoleName, &a.Status, &a.LastLoginAt, &a.CreatedAt, &pwd)
	return a, pwd, err
}

func (r *AdminRepo) FindByID(ctx context.Context, id string) (models.Admin, error) {
	var a models.Admin
	err := r.DB.QueryRow(ctx, `
		SELECT a.id::text, a.username, a.nickname, COALESCE(a.role_id::text,''), COALESCE(ro.name,''),
		       a.status, a.last_login_at, a.created_at
		FROM admins a LEFT JOIN roles ro ON ro.id = a.role_id
		WHERE a.id=$1::uuid`, id,
	).Scan(&a.ID, &a.Username, &a.Nickname, &a.RoleID, &a.RoleName, &a.Status, &a.LastLoginAt, &a.CreatedAt)
	return a, err
}

func (r *AdminRepo) UpdateLastLogin(ctx context.Context, id string) error {
	_, err := r.DB.Exec(ctx, `UPDATE admins SET last_login_at=NOW() WHERE id=$1::uuid`, id)
	return err
}

func (r *AdminRepo) ListAdmins(ctx context.Context) ([]models.Admin, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT a.id::text, a.username, a.nickname, COALESCE(a.role_id::text,''), COALESCE(ro.name,''),
		       a.status, a.last_login_at, a.created_at
		FROM admins a LEFT JOIN roles ro ON ro.id = a.role_id
		ORDER BY a.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Admin, 0)
	for rows.Next() {
		var a models.Admin
		if err := rows.Scan(&a.ID, &a.Username, &a.Nickname, &a.RoleID, &a.RoleName, &a.Status, &a.LastLoginAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, nil
}

func (r *AdminRepo) CreateAdmin(ctx context.Context, username, pwdHash, nickname, roleID, status string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO admins(username, password_hash, nickname, role_id, status)
		VALUES($1,$2,$3,$4::uuid,$5)`, username, pwdHash, nickname, roleID, status)
	return err
}

func (r *AdminRepo) UpdateAdmin(ctx context.Context, id string, nickname, roleID, status, newPwdHash string) error {
	_, err := r.DB.Exec(ctx, `
		UPDATE admins SET
			nickname = COALESCE(NULLIF($2,''), nickname),
			role_id  = COALESCE(NULLIF($3,'')::uuid, role_id),
			status   = COALESCE(NULLIF($4,''), status),
			password_hash = COALESCE(NULLIF($5,''), password_hash),
			updated_at = NOW()
		WHERE id=$1::uuid`, id, nickname, roleID, status, newPwdHash)
	return err
}

// ===== 角色与权限 =====
func (r *AdminRepo) ListRoles(ctx context.Context) ([]models.Role, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT r.id::text, r.name, r.description, r.created_at
		FROM roles r ORDER BY r.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.Role, 0)
	for rows.Next() {
		var role models.Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Description, &role.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, role)
	}
	return list, nil
}

func (r *AdminRepo) CreateRole(ctx context.Context, name, desc string) (string, error) {
	var id string
	err := r.DB.QueryRow(ctx, `
		INSERT INTO roles(name, description) VALUES($1,$2) RETURNING id::text`, name, desc).Scan(&id)
	return id, err
}

func (r *AdminRepo) SetRolePermissions(ctx context.Context, roleID string, perms []string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id=$1::uuid`, roleID); err != nil {
		return err
	}
	for _, p := range perms {
		if _, err := tx.Exec(ctx, `INSERT INTO role_permissions(role_id, permission) VALUES($1::uuid,$2)`, roleID, p); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *AdminRepo) GetAdminPermissions(ctx context.Context, adminID string) ([]string, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT rp.permission FROM role_permissions rp
		JOIN admins a ON a.role_id = rp.role_id
		WHERE a.id=$1::uuid`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	perms := make([]string, 0)
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, nil
}

// HasPermission 校验权限（超级管理员角色拥有所有权限）
func (r *AdminRepo) HasPermission(ctx context.Context, adminID, permission string) (bool, error) {
	var isSuper bool
	var roleName string
	_ = r.DB.QueryRow(ctx, `
		SELECT COALESCE(ro.name,'') FROM admins a LEFT JOIN roles ro ON ro.id=a.role_id WHERE a.id=$1::uuid`,
		adminID).Scan(&roleName)
	if roleName == "super_admin" {
		return true, nil
	}
	err := r.DB.QueryRow(ctx, `
		SELECT 1 FROM role_permissions rp
		JOIN admins a ON a.role_id=rp.role_id
		WHERE a.id=$1::uuid AND rp.permission=$2`, adminID, permission).Scan(&isSuper)
	return err == nil, nil
}

// ===== 操作日志 =====
func (r *AdminRepo) LogOperation(ctx context.Context, adminID, action, targetType, targetID, detail, ip string) error {
	_, err := r.DB.Exec(ctx, `
		INSERT INTO admin_operation_logs(admin_id, action, target_type, target_id, detail_json, ip)
		VALUES($1::uuid,$2,$3,$4,$5,$6)`, adminID, action, targetType, targetID, detail, ip)
	return err
}

func (r *AdminRepo) ListOperationLogs(ctx context.Context, limit, offset int) ([]models.OperationLog, error) {
	rows, err := r.DB.Query(ctx, `
		SELECT l.id, l.admin_id::text, COALESCE(a.nickname,''), l.action, l.target_type,
		       l.target_id, l.detail_json, l.ip, l.created_at
		FROM admin_operation_logs l LEFT JOIN admins a ON a.id=l.admin_id
		ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]models.OperationLog, 0)
	for rows.Next() {
		var l models.OperationLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.AdminName, &l.Action, &l.TargetType,
			&l.TargetID, &l.DetailJSON, &l.IP, &l.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, l)
	}
	return list, nil
}

// SeedDefault 初始化超级管理员角色和默认账号
func (r *AdminRepo) SeedDefault(ctx context.Context) error {
	var roleID string
	err := r.DB.QueryRow(ctx, `SELECT id::text FROM roles WHERE name='super_admin'`).Scan(&roleID)
	if err == pgx.ErrNoRows {
		if err := r.DB.QueryRow(ctx, `INSERT INTO roles(name, description) VALUES('super_admin','超级管理员') RETURNING id::text`).Scan(&roleID); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	var cnt int
	_ = r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM admins`).Scan(&cnt)
	if cnt == 0 {
		b, _ := bcrypt.GenerateFromPassword([]byte("123456"), bcrypt.DefaultCost)
		_, err := r.DB.Exec(ctx, `
			INSERT INTO admins(username, password_hash, nickname, role_id, status)
			VALUES('admin',$1,'超级管理员',$2::uuid,'active')`, string(b), roleID)
		return err
	}
	return nil
}
