package service

import (
	"context"
	"errors"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	captcha "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/captcha/v20190722"
)

// CaptchaVerifier 腾讯云图形验证码（天御 Captcha）校验器
type CaptchaVerifier struct {
	AppID        int64  // 验证码应用 ID
	AppSecretKey string // 验证码应用密钥
	SecretID     string // 腾讯云 API 密钥
	SecretKey    string
}

// Enabled 凭据未配置完整时返回 false（开发/未接入环境跳过校验）
func (v *CaptchaVerifier) Enabled() bool {
	return v.AppID > 0 && v.AppSecretKey != "" && v.SecretID != "" && v.SecretKey != ""
}

// Verify 校验前端传来的 ticket + randstr，通过返回 nil
func (v *CaptchaVerifier) Verify(ctx context.Context, ticket, randstr, userIP string) error {
	if !v.Enabled() {
		return nil
	}
	if ticket == "" || randstr == "" {
		return errors.New("captcha ticket required")
	}
	cred := common.NewCredential(v.SecretID, v.SecretKey)
	client, err := captcha.NewClient(cred, "", profile.NewClientProfile())
	if err != nil {
		return err
	}
	req := captcha.NewDescribeCaptchaResultRequest()
	req.CaptchaAppId = common.Uint64Ptr(uint64(v.AppID))
	req.AppSecretKey = common.StringPtr(v.AppSecretKey)
	req.CaptchaType = common.Uint64Ptr(9) // 9 = 图形验证码
	req.Ticket = common.StringPtr(ticket)
	req.Randstr = common.StringPtr(randstr)
	if userIP != "" {
		req.UserIp = common.StringPtr(userIP)
	}
	resp, err := client.DescribeCaptchaResult(req)
	if err != nil {
		return err
	}
	if resp.Response.CaptchaCode == nil || *resp.Response.CaptchaCode != 0 {
		return errors.New("captcha verify failed")
	}
	return nil
}
