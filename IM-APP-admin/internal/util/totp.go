package util

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"strings"
	"time"
)

// GenerateTOTPSecret 生成 base32 编码的 TOTP 密钥（RFC6238，30s 步长，6 位）
func GenerateTOTPSecret() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b)
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	return enc.EncodeToString(b)
}

// ValidateTOTP 校验 6 位 TOTP 码（允许 ±1 步漂移）
func ValidateTOTP(secret, code string) bool {
	if secret == "" || len(code) != 6 {
		return false
	}
	now := time.Now().Unix() / 30
	for _, offset := range []int64{0, -1, 1} {
		if totpAt(secret, now+offset) == code {
			return true
		}
	}
	return false
}

func totpAt(secret string, counter int64) string {
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	key, err := enc.DecodeString(strings.ToUpper(secret))
	if err != nil {
		return ""
	}
	msg := make([]byte, 8)
	binary.BigEndian.PutUint64(msg, uint64(counter))
	mac := hmac.New(sha1.New, key)
	mac.Write(msg)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := (int64(sum[offset])&0x7f)<<24 |
		int64(sum[offset+1])<<16 |
		int64(sum[offset+2])<<8 |
		int64(sum[offset+3])
	return padCode(code % 1000000)
}

func padCode(v int64) string {
	digits := "0123456789"
	out := make([]byte, 6)
	for i := 5; i >= 0; i-- {
		out[i] = digits[v%10]
		v /= 10
	}
	return string(out)
}
