package handler

import (
	"encoding/json"
	"net/url"
	"strings"
)

// extractQRToken 从 JSON payload、完整 URL 或裸 token 中提取二维码 token
func extractQRToken(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	var m map[string]string
	if err := json.Unmarshal([]byte(raw), &m); err == nil {
		if t := m["token"]; t != "" {
			return t
		}
	}

	if u, err := url.Parse(raw); err == nil && u.Scheme != "" {
		if q := u.Query().Get("qrcode"); q != "" {
			return q
		}
	}

	return raw
}
