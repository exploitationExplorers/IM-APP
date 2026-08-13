package models

import "time"

// ===== 管理员与权限 =====
type Admin struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	Nickname    string     `json:"nickname"`
	RoleID      string     `json:"roleId"`
	RoleName    string     `json:"roleName"`
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type Role struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Permissions []string  `json:"permissions,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResult struct {
	Token string `json:"token"`
	Admin Admin  `json:"admin"`
}

type AdminRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
	RoleID   string `json:"roleId"`
	Status   string `json:"status"`
}

type OperationLog struct {
	ID         int64     `json:"id"`
	AdminID    string    `json:"adminId"`
	AdminName  string    `json:"adminName"`
	Action     string    `json:"action"`
	TargetType string    `json:"targetType"`
	TargetID   string    `json:"targetId"`
	DetailJSON string    `json:"detailJson"`
	IP         string    `json:"ip"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ===== 用户管理（复用 APP users 表） =====
type AdminUser struct {
	ID          string    `json:"id"`
	PhoneMasked string    `json:"phoneMasked"`
	CountryCode string    `json:"countryCode"`
	PublicID    string    `json:"publicId"`
	Nickname    string    `json:"nickname"`
	Avatar      string    `json:"avatar"`
	Status      string    `json:"status"`
	FriendCount int64     `json:"friendCount"`
	GroupCount  int64     `json:"groupCount"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminUserDetail struct {
	AdminUser
	Bio         string `json:"bio"`
	ReportCount int64  `json:"reportCount"`
}

type UpdateUserStatusRequest struct {
	Status string `json:"status"` // active|restricted|banned|canceled
}

type ReportRecord struct {
	ID          string    `json:"id"`
	TargetType  string    `json:"targetType"`
	Reason      string    `json:"reason"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ===== 群组管理（复用 APP groups 表） =====
type AdminGroup struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Avatar      string    `json:"avatar"`
	OwnerID     string    `json:"ownerId"`
	MemberCount int64     `json:"memberCount"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminGroupDetail struct {
	AdminGroup
	JoinMode             string `json:"joinMode"`             // direct|approval
	AllowMemberAddFriend bool   `json:"allowMemberAddFriend"` // 是否允许成员互加好友
	AllMuted             bool   `json:"allMuted"`             // 全员禁言
	Announcement         string `json:"announcement"`
}

type AdminGroupMember struct {
	UserID     string `json:"userId"`
	Nickname   string `json:"nickname"`
	Role       string `json:"role"`
	MutedUntil string `json:"mutedUntil,omitempty"`
	JoinedAt   string `json:"joinedAt"`
}

type RecallLog struct {
	ID        string    `json:"id"`
	GroupID   string    `json:"groupId"`
	Operator  string    `json:"operator"`
	MessageID string    `json:"messageId"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

type UpdateGroupStatusRequest struct {
	Status string `json:"status"` // normal|banned|dissolved
}

// UpdateGroupSettingsRequest 群公共设置（传哪个改哪个）
type UpdateGroupSettingsRequest struct {
	JoinMode             *string `json:"joinMode,omitempty"`             // direct|approval
	AllowMemberAddFriend *bool   `json:"allowMemberAddFriend,omitempty"` // 是否允许成员互加好友
	AllMuted             *bool   `json:"allMuted,omitempty"`             // 全员禁言
}

// ===== 转发任务管理（复用 APP forward_tasks 表） =====
type AdminForwardTask struct {
	ID           string     `json:"id"`
	UserID       string     `json:"userId"`
	SourceMsgID  string     `json:"sourceMessageId"`
	Status       string     `json:"status"`
	TargetCount  int64      `json:"targetCount"`
	SuccessCount int64      `json:"successCount"`
	FailedCount  int64      `json:"failedCount"`
	SkippedCount int64      `json:"skippedCount"`
	CreatedAt    time.Time  `json:"createdAt"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
}

// ===== 短信记录（复用 APP sms_send_logs 表） =====
type SmsLog struct {
	ID          int64     `json:"id"`
	PhoneE164   string    `json:"phoneE164"`
	CountryCode string    `json:"countryCode"`
	Scene       string    `json:"scene"`
	Status      string    `json:"status"`
	ErrorCode   string    `json:"errorCode"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Country struct {
	Code     string `json:"code"`
	DialCode string `json:"dialCode"`
	CNName   string `json:"cnName"`
	ENName   string `json:"enName"`
	Enabled  bool   `json:"enabled"`
}

type UpdateCountryRequest struct {
	Enabled *bool `json:"enabled"`
}

// ===== 运营配置 =====
type AppVersion struct {
	ID           string    `json:"id"`
	Platform     string    `json:"platform"`
	Version      string    `json:"version"`
	Description  string    `json:"description"`
	DownloadURL  string    `json:"downloadUrl"`
	ForceUpgrade bool      `json:"forceUpgrade"`
	CreatedAt    time.Time `json:"createdAt"`
}

type AppPolicy struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Version   string    `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
}

type SensitiveWord struct {
	ID        string    `json:"id"`
	Word      string    `json:"word"`
	Category  string    `json:"category"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}
