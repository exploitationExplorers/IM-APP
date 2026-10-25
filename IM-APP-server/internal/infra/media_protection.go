package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const MediaGCProtocol = "im-app-media-gc-v1"

var ErrMediaProtection = errors.New("媒体引用保护暂不可用，请稍后重试")

// MediaProtection registers a conservative permanent source pin before a
// business write or archive copy. False-positive pins only retain extra bytes;
// inability to register must never result in a successful dangling reference.
type MediaProtection struct {
	endpoint string
	key      string
	client   *http.Client
}

func NewMediaProtection(base, key string) (*MediaProtection, error) {
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") ||
		len(key) < 32 || strings.ContainsAny(key, "\r\n") {
		return nil, ErrMediaProtection
	}
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil // The bridge is private; do not send its bearer through a proxy.
	return &MediaProtection{endpoint: strings.TrimRight(base, "/") + "/internal/media-gc/protect", key: key,
		client: &http.Client{Timeout: 5 * time.Second, Transport: t,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (p *MediaProtection) Hold(ctx context.Context, content string) error {
	if p == nil {
		return nil
	}
	// Ordinary text/JSON must continue to work if the optional bridge is down.
	// A full resolver on the bridge handles encoded/nested native field shapes.
	if !strings.Contains(strings.ToLower(content), "http") && !strings.Contains(content, "object") &&
		!strings.Contains(content, "managed") && !strings.Contains(content, "\\u") && !strings.Contains(content, "\\/") {
		return nil
	}
	if len(content) > 4<<20 {
		return ErrMediaProtection
	}
	body, err := json.Marshal(struct {
		Content string `json:"content"`
	}{content})
	if err != nil {
		return ErrMediaProtection
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return ErrMediaProtection
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.key)
	res, err := p.client.Do(req)
	if err != nil {
		return ErrMediaProtection
	}
	defer res.Body.Close()
	var result struct {
		Protocol string `json:"protocol"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&result) != nil || result.Protocol != MediaGCProtocol {
		return ErrMediaProtection
	}
	return nil
}
