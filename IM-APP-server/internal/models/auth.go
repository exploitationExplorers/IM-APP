package models

// 认证模块 DTO（按 GOAL-APP 接口清单）

type Empty struct {
	OK bool `json:"ok"`
}

type SendSMSRequest struct {
	CountryCode string `json:"countryCode"`
	Phone       string `json:"phone"`
	Scene       string `json:"scene"` // register|login|reset
	DeviceID    string `json:"deviceId"`
}

type SendSMSResult struct {
	RetryAfterSec int    `json:"retryAfterSec"`
	ExpiresIn     int    `json:"expiresIn"`
	DevCode       string `json:"devCode,omitempty"` // 仅开发环境返回，便于联调
}

type RegisterRequest struct {
	CountryCode string `json:"countryCode"`
	Phone       string `json:"phone"`
	Code        string `json:"code"`
	Password    string `json:"password"`
	DeviceID    string `json:"deviceId"`
}

type PasswordLoginRequest struct {
	CountryCode string `json:"countryCode"`
	Phone       string `json:"phone"`
	Password    string `json:"password"`
	DeviceID    string `json:"deviceId"`
}

type SMSLoginRequest struct {
	CountryCode string `json:"countryCode"`
	Phone       string `json:"phone"`
	Code        string `json:"code"`
	DeviceID    string `json:"deviceId"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refreshToken"`
	DeviceID     string `json:"deviceId"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type ResetPasswordRequest struct {
	CountryCode string `json:"countryCode"`
	Phone       string `json:"phone"`
	Code        string `json:"code"`
	Password    string `json:"password"`
}

type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
}

type AuthResult struct {
	TokenPair
	User MeProfile `json:"user"`
}

// MeProfile 本人资料。接口不返回明文手机号；安全页用登录时本地缓存的号码展示完整号。
type MeProfile struct {
	ID          string `json:"id"`
	Phone       string `json:"phone,omitempty"`
	PhoneMasked string `json:"phoneMasked"`
	CountryCode string `json:"countryCode"`
	PublicID    string `json:"publicId"`
	Nickname    string `json:"nickname"`
	Avatar      string `json:"avatar"`
	Bio         string `json:"bio"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	HasPassword bool   `json:"hasPassword"`
}

// UpdateProfileRequest 修改本人资料（指针字段，传了才更新）
type UpdateProfileRequest struct {
	Nickname     *string `json:"nickname,omitempty"`
	AvatarFileID *string `json:"avatarFileId,omitempty"`
	Bio          *string `json:"bio,omitempty"`
}
