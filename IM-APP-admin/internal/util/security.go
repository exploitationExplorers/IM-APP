package util

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// NewUUID 生成随机 UUID v4 字符串
func NewUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// 极端情况下退回时间戳派生值
		return RandomHex(16)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	dst := make([]byte, 36)
	hex.Encode(dst[0:8], b[0:4])
	dst[8] = '-'
	hex.Encode(dst[9:13], b[4:6])
	dst[13] = '-'
	hex.Encode(dst[14:18], b[6:8])
	dst[18] = '-'
	hex.Encode(dst[19:23], b[8:10])
	dst[23] = '-'
	hex.Encode(dst[24:36], b[10:16])
	return string(dst)
}

// RandomHex 生成 n 字节随机数的十六进制串
func RandomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// SHA256Hex 返回 sha256 十六进制
func SHA256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// MaskPhone 手机号脱敏：138****6621（保留前3后4；过短则全掩）
func MaskPhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if len(phone) <= 4 {
		return "****"
	}
	if len(phone) <= 7 {
		return phone[:1] + "****" + phone[len(phone)-1:]
	}
	return phone[:3] + "****" + phone[len(phone)-4:]
}

// MaskIP IP 脱敏：保留前两段
func MaskIP(ip string) string {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return "***"
	}
	return parts[0] + "." + parts[1] + ".***.***"
}
