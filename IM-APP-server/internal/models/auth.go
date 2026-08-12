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
	Ticket      string `json:"ticket"`  // 腾讯云图形验证码 ticket
	Randstr     string `json:"randstr"` // 腾讯云图形验证码 randstr
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

// MeProfile 本人资料（对外 DTO，不含手机号明文）
type MeProfile struct {
	ID          string `json:"id"`
	PhoneMasked string `json:"phoneMasked"`
	CountryCode string `json:"countryCode"`
	PublicID    string `json:"publicId"`
	Nickname    string `json:"nickname"`
	Avatar      string `json:"avatar"`
	Bio         string `json:"bio"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
}
