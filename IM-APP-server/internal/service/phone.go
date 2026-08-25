package service

import (
	"errors"
	"strings"
)

// NormalizeE164 手机号 E.164 归一化（宽松校验，测试阶段）
// countryCode: 国家区号，如 "+86" / "86"
// national:    本地号码，如 "13800138000"
// 返回标准 E.164，如 "+8613800138000"
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
	digits := len(dial) + len(num)
	if digits < 8 || digits > 15 {
		return "", errors.New("invalid phone length")
	}
	return "+" + dial + num, nil
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

// MaskPublicID 脱敏聊天号：保留前 2 后 2，如 ch****01；短 ID 全掩码
func MaskPublicID(publicID string) string {
	runes := []rune(strings.TrimSpace(publicID))
	n := len(runes)
	if n == 0 {
		return ""
	}
	if n <= 4 {
		return strings.Repeat("*", n)
	}
	return string(runes[:2]) + "****" + string(runes[n-2:])
}
