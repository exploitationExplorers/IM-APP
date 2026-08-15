package service

import (
	"context"
	"errors"
	"time"

	"im-app-admin/internal/middleware"
	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"
	"im-app-admin/internal/util"

	"golang.org/x/crypto/bcrypt"
)

// ScopeMFA 仅用于 MFA 二次验证的临时挑战 token
const ScopeMFA = "mfa"

var ErrInvalidCredentials = errors.New("账号或密码错误")
var ErrMFARequired = errors.New("需要二次验证")
var ErrAccountDisabled = errors.New("账号已停用")
var ErrAccountLocked = errors.New("登录失败次数过多，已临时锁定")

// AuthService 管理员认证、会话、MFA
type AuthService struct {
	Auth       *repository.AuthRepo
	Rbac       *repository.RBACRepo
	Audit      *repository.AuditRepo
	Secret     string
	Issuer     string
	Audience   string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	MFATTL     time.Duration
}

// Login 密码登录：成功签发 token；启用 MFA 时返回 MFAChallenge
func (s *AuthService) Login(ctx context.Context, username, password, device, ip, ua, requestID string) (*models.LoginResult, error) {
	account, pwd, err := s.Auth.FindByUsername(ctx, username)
	if err != nil {
		_ = s.Auth.InsertLoginLog(ctx, "", false, "account_not_found", ip, ua, requestID)
		return nil, ErrInvalidCredentials
	}
	if account.Status != "active" {
		_ = s.Auth.InsertLoginLog(ctx, account.ID, false, "account_disabled", ip, ua, requestID)
		return nil, ErrAccountDisabled
	}
	if bcrypt.CompareHashAndPassword([]byte(pwd), []byte(password)) != nil {
		_ = s.Auth.InsertLoginLog(ctx, account.ID, false, "bad_password", ip, ua, requestID)
		return nil, ErrInvalidCredentials
	}

	// 已启用 MFA：签发带 scope=mfa 的挑战 token，要求二次验证
	if account.MFAEnabled {
		challenge, err := middleware.IssueScopeToken(s.Secret, s.Issuer, s.Audience, account.ID, ScopeMFA, s.MFATTL)
		if err != nil {
			return nil, err
		}
		return &models.LoginResult{MFAChallenge: challenge, Admin: *account}, ErrMFARequired
	}

	result, err := s.completeLogin(ctx, *account, device, ip, ua, requestID)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// VerifyMFA 校验挑战 token + TOTP 码，成功后签发正式 token
func (s *AuthService) VerifyMFA(ctx context.Context, challengeToken, code, device, ip, ua, requestID string) (*models.LoginResult, error) {
	adminID, err := middleware.ValidateScopeToken(s.Secret, s.Issuer, s.Audience, challengeToken, ScopeMFA)
	if err != nil {
		return nil, errors.New("验证凭证已过期")
	}
	account, err := s.Auth.FindByID(ctx, adminID)
	if err != nil {
		return nil, errors.New("管理员不存在")
	}
	secret, err := s.Auth.GetMFA(ctx, account.ID)
	if err != nil || !util.ValidateTOTP(secret, code) {
		_ = s.Auth.InsertLoginLog(ctx, account.ID, false, "mfa_failed", ip, ua, requestID)
		return nil, errors.New("二次验证码错误")
	}
	result, err := s.completeLogin(ctx, *account, device, ip, ua, requestID)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// completeLogin 完成登录：更新最后登录、写成功日志、签发 token 与会话
func (s *AuthService) completeLogin(ctx context.Context, account models.AdminAccount, device, ip, ua, requestID string) (*models.LoginResult, error) {
	_ = s.Auth.UpdateLastLogin(ctx, account.ID)
	_ = s.Auth.InsertLoginLog(ctx, account.ID, true, "", ip, ua, requestID)

	access, err := middleware.IssueAccessToken(s.Secret, s.Issuer, s.Audience, account.ID, s.AccessTTL)
	if err != nil {
		return nil, err
	}
	rawRefresh, hashRefresh := middleware.IssueRefreshToken()
	expires := time.Now().Add(s.RefreshTTL)
	if _, err := s.Auth.CreateSession(ctx, account.ID, hashRefresh, device, ip, ua, expires); err != nil {
		return nil, err
	}
	return &models.LoginResult{
		Token:        access,
		RefreshToken: rawRefresh,
		Admin:        account,
	}, nil
}

// Refresh 用 refresh token 换取新的 access（并轮换 refresh token）
func (s *AuthService) Refresh(ctx context.Context, rawRefresh, device, ip string) (*models.LoginResult, error) {
	hash := middleware.HashRefreshToken(rawRefresh)
	sess, err := s.Auth.FindSessionByRefresh(ctx, hash)
	if err != nil {
		return nil, errors.New("refresh token 无效")
	}
	if sess.RevokedAt != nil || time.Now().After(sess.ExpiresAt) {
		return nil, errors.New("refresh token 已失效")
	}
	account, err := s.Auth.FindByID(ctx, sess.AdminID)
	if err != nil || account.Status != "active" {
		return nil, errors.New("账号不可用")
	}
	// 轮换：撤销旧 refresh，签发新 refresh
	_ = s.Auth.RevokeSessionByID(ctx, sess.ID)
	access, err := middleware.IssueAccessToken(s.Secret, s.Issuer, s.Audience, account.ID, s.AccessTTL)
	if err != nil {
		return nil, err
	}
	rawNew, hashNew := middleware.IssueRefreshToken()
	expires := time.Now().Add(s.RefreshTTL)
	if _, err := s.Auth.CreateSession(ctx, account.ID, hashNew, device, ip, sess.UserAgent, expires); err != nil {
		return nil, err
	}
	return &models.LoginResult{Token: access, RefreshToken: rawNew, Admin: *account}, nil
}

// Logout 退出当前会话（撤销对应 refresh）
func (s *AuthService) Logout(ctx context.Context, rawRefresh string) error {
	hash := middleware.HashRefreshToken(rawRefresh)
	sess, err := s.Auth.FindSessionByRefresh(ctx, hash)
	if err != nil {
		return errors.New("会话不存在")
	}
	return s.Auth.RevokeSessionByID(ctx, sess.ID)
}

// LogoutAll 退出全部会话（停用管理员后调用也生效）
func (s *AuthService) LogoutAll(ctx context.Context, adminID string) error {
	return s.Auth.RevokeAllSessions(ctx, adminID)
}

// Me 当前管理员资料与权限
func (s *AuthService) Me(ctx context.Context, adminID string) (*models.MeResult, error) {
	account, err := s.Auth.FindByID(ctx, adminID)
	if err != nil {
		return nil, err
	}
	perms := make([]string, 0)
	super, _ := s.Rbac.IsSuperAdmin(ctx, adminID)
	if super {
		all, _ := s.Rbac.ListPermissions(ctx)
		for _, p := range all {
			perms = append(perms, p.Code)
		}
	} else {
		perms, _ = s.adminPermissions(ctx, adminID)
	}
	return &models.MeResult{Admin: *account, Permissions: perms}, nil
}

func (s *AuthService) adminPermissions(ctx context.Context, adminID string) ([]string, error) {
	roleIDs, _ := s.Auth.RoleIDs(ctx, adminID)
	permSet := make(map[string]struct{})
	for _, rid := range roleIDs {
		perms, _ := s.Rbac.GetRolePermissions(ctx, rid)
		for _, p := range perms {
			permSet[p] = struct{}{}
		}
	}
	out := make([]string, 0, len(permSet))
	for p := range permSet {
		out = append(out, p)
	}
	return out, nil
}

// ChangePassword 修改本人密码
func (s *AuthService) ChangePassword(ctx context.Context, adminID, oldPwd, newPwd string) error {
	_, pwd, err := s.Auth.FindByUsername(ctx, s.AuthUsername(ctx, adminID))
	if err != nil {
		return errors.New("账号不存在")
	}
	if bcrypt.CompareHashAndPassword([]byte(pwd), []byte(oldPwd)) != nil {
		return errors.New("原密码错误")
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(newPwd), bcrypt.DefaultCost)
	return s.Auth.UpdatePassword(ctx, adminID, string(hash))
}

// MFAStatus 返回 MFA 是否启用及 secret（仅未启用时可返回 secret 用于绑定）
func (s *AuthService) MFAStatus(ctx context.Context, adminID string) (secret string, enabled bool, err error) {
	secret, err = s.Auth.GetMFA(ctx, adminID)
	if err != nil {
		return "", false, err
	}
	return secret, secret != "", nil
}

// SetupMFA 验证 TOTP 码后启用 MFA
func (s *AuthService) SetupMFA(ctx context.Context, adminID, code string) error {
	secret, err := s.Auth.GetMFA(ctx, adminID)
	if err != nil {
		return err
	}
	if secret == "" {
		secret = util.GenerateTOTPSecret()
	}
	if !util.ValidateTOTP(secret, code) {
		return errors.New("验证码错误")
	}
	return s.Auth.SetMFA(ctx, adminID, secret)
}

// DisableMFA 验证 TOTP 码后关闭 MFA
func (s *AuthService) DisableMFA(ctx context.Context, adminID, code string) error {
	secret, err := s.Auth.GetMFA(ctx, adminID)
	if err != nil {
		return err
	}
	if !util.ValidateTOTP(secret, code) {
		return errors.New("验证码错误")
	}
	return s.Auth.SetMFA(ctx, adminID, "")
}

// ResetMFA 管理员重置他人 MFA（需 admins.security 权限）
func (s *AuthService) ResetMFA(ctx context.Context, adminID string) error {
	return s.Auth.SetMFA(ctx, adminID, "")
}

// AuthUsername 取管理员用户名（ChangePassword 辅助）
func (s *AuthService) AuthUsername(ctx context.Context, adminID string) string {
	a, err := s.Auth.FindByID(ctx, adminID)
	if err != nil {
		return ""
	}
	return a.Username
}
