package service

import (
	"errors"
	"strings"

	"github.com/nyaruka/phonenumbers"
)

// NormalizeE164 手机号 E.164 归一化 + 严格校验（libphonenumber 规则）
// countryCode: 国家区号，如 "+86" / "86" / "0086"
// national:    本地号码，如 "13800138000"
// 返回标准 E.164，如 "+8613800138000"；号码无效时报错
func NormalizeE164(countryCode, national string) (string, error) {
	dial := digitsOnly(countryCode)
	num := digitsOnly(national)
	if dial == "" {
		// 未传区号时按中国区号处理（默认 +86）
		dial = "86"
	}
	if num == "" {
		return "", errors.New("phone required")
	}
	// 去掉本地号码中可能重复的国家码前缀
	num = strings.TrimPrefix(num, dial)
	if num == "" {
		return "", errors.New("phone required")
	}
	// libphonenumber 严格校验（按各国号码规则）
	parsed, err := phonenumbers.Parse("+"+dial+num, "")
	if err != nil {
		return "", errors.New("invalid phone number")
	}
	if !phonenumbers.IsValidNumber(parsed) {
		return "", errors.New("invalid phone number")
	}
	return phonenumbers.Format(parsed, phonenumbers.E164), nil
}

// 取纯数字（去掉 +、空格、-、括号等）
func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// MaskPhone 脱敏展示：保留前 3 后 4，如 138****8000
func MaskPhone(national string) string {
	digits := digitsOnly(national)
	if len(digits) <= 7 {
		return strings.Repeat("*", len(digits))
	}
	return digits[:3] + "****" + digits[len(digits)-4:]
}
