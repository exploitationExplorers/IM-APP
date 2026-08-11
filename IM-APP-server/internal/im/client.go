package im

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"im-app-server/internal/config"
)

// Client wraps OpenIM REST API (Phase 4).
type Client struct {
	cfg    config.OpenIMConfig
	client *http.Client
}

func NewClient(cfg config.OpenIMConfig) *Client {
	return &Client{
		cfg: cfg,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) Available() bool {
	return c != nil && c.cfg.APIURL != ""
}

type TokenResult struct {
	Token     string `json:"token"`
	ExpireSec int    `json:"expireSec"`
	Platform  int    `json:"platform"`
	UserID    string `json:"userId"`
	DevMode   bool   `json:"devMode,omitempty"`
}

// IssueUserToken returns OpenIM user token; dev stub when OpenIM is not configured.
func (c *Client) IssueUserToken(ctx context.Context, userID string, platformID int) (TokenResult, error) {
	if platformID == 0 {
		platformID = 5 // uni-app default
	}
	if !c.Available() {
		return TokenResult{
			Token:     fmt.Sprintf("dev-openim-token-%s", userID),
			ExpireSec: 7 * 24 * 3600,
			Platform:  platformID,
			UserID:    userID,
			DevMode:   true,
		}, nil
	}
	body, _ := json.Marshal(map[string]interface{}{
		"secret":     c.cfg.Secret,
		"platformID": platformID,
		"userID":     userID,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.APIURL+"/auth/user_token", bytes.NewReader(body))
	if err != nil {
		return TokenResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("operationID", fmt.Sprintf("%d", time.Now().UnixNano()))
	resp, err := c.client.Do(req)
	if err != nil {
		return TokenResult{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return TokenResult{}, fmt.Errorf("openim token: %s", string(raw))
	}
	var parsed struct {
		Data struct {
			Token             string `json:"token"`
			ExpireTimeSeconds int    `json:"expireTimeSeconds"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return TokenResult{}, err
	}
	return TokenResult{
		Token:     parsed.Data.Token,
		ExpireSec: parsed.Data.ExpireTimeSeconds,
		Platform:  platformID,
		UserID:    userID,
	}, nil
}

// SyncUser registers or updates user in OpenIM (no-op stub when unavailable).
func (c *Client) SyncUser(ctx context.Context, userID, nickname, avatar string) error {
	if !c.Available() {
		return nil
	}
	body, _ := json.Marshal(map[string]interface{}{
		"secret": c.cfg.Secret,
		"users": []map[string]string{
			{"userID": userID, "nickname": nickname, "faceURL": avatar},
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.APIURL+"/user/user_register", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("operationID", fmt.Sprintf("%d", time.Now().UnixNano()))
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("openim sync user: %s", string(raw))
	}
	return nil
}
