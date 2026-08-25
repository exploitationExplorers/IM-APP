package infra

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
)

// ComputeFingerprint 从 HTTP 请求头提取信号，计算服务端设备指纹。
// 返回指纹 hex 字符串（32 字符）和是否检测到可疑不一致。
//
// 指纹 = SHA256("UA=...|LANG=...|ACC=...|ENC=...|CHUA=...|CHPL=...") 取前 16 字节 hex。
// 单一信号可伪造，但同时伪造全部信号且保持一致的难度较高。
func ComputeFingerprint(r *http.Request) (fingerprint string, suspicious bool) {
	ua := truncate(r.UserAgent(), 255)
	lang := r.Header.Get("Accept-Language")
	acc := r.Header.Get("Accept")
	enc := r.Header.Get("Accept-Encoding")
	chUA := r.Header.Get("Sec-CH-UA")
	chPl := r.Header.Get("Sec-CH-UA-Platform")

	raw := "UA=" + ua +
		"|LANG=" + lang +
		"|ACC=" + acc +
		"|ENC=" + enc +
		"|CHUA=" + chUA +
		"|CHPL=" + chPl

	sum := sha256.Sum256([]byte(raw))
	fingerprint = hex.EncodeToString(sum[:16]) // 前 16 字节 = 32 hex 字符

	suspicious = detectInconsistency(ua, chPl)
	return
}

// detectInconsistency 检查 UA 声明的平台与 Client Hints 平台是否矛盾。
// 例如 UA 含 "Windows" 但 Sec-CH-UA-Platform 报 "macOS"，说明请求头被篡改或不一致。
func detectInconsistency(ua, chPlatform string) bool {
	if chPlatform == "" {
		return false // 无 Client Hints 无法判断
	}
	chLower := strings.ToLower(chPlatform)

	// 从 UA 中推断平台关键词（移动端优先，因为 iPhone UA 含 "Mac OS X"，Android UA 含 "Linux"）
	uaLower := strings.ToLower(ua)
	var uaPlatform string
	switch {
	case strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "ipad"):
		uaPlatform = "ios"
	case strings.Contains(uaLower, "android"):
		uaPlatform = "android"
	case strings.Contains(uaLower, "windows"):
		uaPlatform = "windows"
	case strings.Contains(uaLower, "macintosh") || strings.Contains(uaLower, "mac os"):
		uaPlatform = "macos"
	case strings.Contains(uaLower, "linux"):
		uaPlatform = "linux"
	}

	if uaPlatform == "" {
		return false // UA 中无法识别平台，不判定
	}

	// Client Hints 平台值通常是 "Windows", "macOS", "Linux", "Android", "iOS" 等
	return !strings.Contains(chLower, uaPlatform)
}

// ParsePlatform 从 User-Agent 推断客户端平台，用于会话管理和互踢策略。
// 返回 "ios"、"android" 或 "web"（兜底）。
func ParsePlatform(ua string) string {
	uaLower := strings.ToLower(ua)
	switch {
	case strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "ipad"):
		return "ios"
	case strings.Contains(uaLower, "android"):
		return "android"
	default:
		return "web"
	}
}

// IsMobilePlatform 判断平台是否为移动端（ios 或 android）。
func IsMobilePlatform(platform string) bool {
	return platform == "ios" || platform == "android"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
