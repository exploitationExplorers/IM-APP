package models

import "time"

// ===== 管理员与 RBAC（清单 01，表：admin_users/admin_roles/...） =====

type AdminAccount struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	Nickname    string     `json:"nickname"`
	Status      string     `json:"status"` // active|disabled
	RoleNames   []string   `json:"roleNames,omitempty"`
	RoleIDs     []string   `json:"roleIds,omitempty"`
	MFAEnabled  bool       `json:"mfaEnabled"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type AdminRole struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Code        string    `json:"code"`
	Description string    `json:"description"`
	Status      string    `json:"status"` // active|disabled
	Permissions []string  `json:"permissions,omitempty"`
	UserCount   int64     `json:"userCount,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminPermission struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Module      string `json:"module"`
	Description string `json:"description"`
}

type AdminSession struct {
	ID        string     `json:"id"`
	AdminID   string     `json:"adminId"`
	Device    string     `json:"device"`
	IP        string     `json:"ip"`
	UserAgent string     `json:"userAgent,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

type LoginResult struct {
	Token        string       `json:"token,omitempty"`
	RefreshToken string       `json:"refreshToken,omitempty"`
	Admin        AdminAccount `json:"admin"`
	MFAChallenge string       `json:"mfaChallenge,omitempty"` // 启用 MFA 时返回的挑战 token
}

type MeResult struct {
	Admin       AdminAccount `json:"admin"`
	Permissions []string     `json:"permissions"`
}

// ===== 审计与登录日志（清单 10，表：admin_audit_logs/admin_login_logs） =====

type AuditLog struct {
	ID         int64     `json:"id"`
	AdminID    string    `json:"adminId,omitempty"`
	AdminName  string    `json:"adminName,omitempty"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	ResourceID string    `json:"resourceId"`
	Reason     string    `json:"reason,omitempty"`
	Before     string    `json:"beforeValue,omitempty"`
	After      string    `json:"afterValue,omitempty"`
	IP         string    `json:"ip"`
	UserAgent  string    `json:"userAgent,omitempty"`
	RequestID  string    `json:"requestId"`
	Result     string    `json:"result"` // success|denied|failed
	CreatedAt  time.Time `json:"createdAt"`
}

type LoginLog struct {
	ID         int64     `json:"id"`
	AdminID    string    `json:"adminId,omitempty"`
	AdminName  string    `json:"adminName,omitempty"`
	Success    bool      `json:"success"`
	FailReason string    `json:"failReason,omitempty"`
	IP         string    `json:"ip"`
	UserAgent  string    `json:"userAgent,omitempty"`
	RequestID  string    `json:"requestId"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ===== 请求模型 =====

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

type MFAResetRequest struct {
	Reason string `json:"reason"`
}

type AdminCreateRequest struct {
	Username string   `json:"username" binding:"required"`
	Password string   `json:"password" binding:"required,min=6"`
	Nickname string   `json:"nickname"`
	RoleIDs  []string `json:"roleIds"`
	Status   string   `json:"status"`
}

type AdminUpdateRequest struct {
	Password string   `json:"password"`
	Nickname string   `json:"nickname"`
	RoleIDs  []string `json:"roleIds"`
	Status   string   `json:"status"`
}

type AdminStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=active disabled"`
	Reason string `json:"reason"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"oldPassword" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required,min=6"`
}

type RoleCreateRequest struct {
	Name        string   `json:"name" binding:"required"`
	Code        string   `json:"code" binding:"required"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

type RoleUpdateRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Status      string   `json:"status"` // active|disabled
	Permissions []string `json:"permissions"`
}
