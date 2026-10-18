package service

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

	"github.com/google/uuid"
	"im-app-server/internal/media"
	"im-app-server/internal/repository"
)

const RetentionAdapterProtocol = "im-app-retention-visibility-v2"

var ErrRetentionAdapter = errors.New("retention adapter unavailable or incompatible")

// RetentionHTTPAdapter talks only to a private, pinned OpenIM extension. It
// never uses ordinary history pagination or a client's maxSeq as a snapshot.
// The extension retains source messages/files for historical quotes/favorites.
type RetentionHTTPAdapter struct {
	base   string
	key    string
	client *http.Client
}

func NewRetentionHTTPAdapter(endpoint, key string) (*RetentionHTTPAdapter, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || len(key) < 32 || strings.ContainsAny(key, "\r\n") {
		return nil, ErrRetentionAdapter
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// A developer/host HTTP_PROXY must not receive this internal bearer key.
	transport.Proxy = nil
	return &RetentionHTTPAdapter{base: strings.TrimRight(endpoint, "/"), key: key,
		client: &http.Client{Transport: transport, Timeout: 50 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (a *RetentionHTTPAdapter) call(ctx context.Context, method, path string, body, out any) error {
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			return ErrRetentionAdapter
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, bytes.NewReader(data))
	if err != nil {
		return ErrRetentionAdapter
	}
	req.Header.Set("Authorization", "Bearer "+a.key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return ErrRetentionAdapter
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ErrRetentionAdapter
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
	if err != nil || len(raw) > 4*1024*1024 {
		return ErrRetentionAdapter
	}
	if json.Unmarshal(raw, out) != nil {
		return ErrRetentionAdapter
	}
	return nil
}

func (a *RetentionHTTPAdapter) Check(ctx context.Context) error {
	var caps struct {
		Protocol string `json:"protocol"`
		Mode     string `json:"mode"`
	}
	if err := a.call(ctx, "GET", "/internal/retention/capabilities", nil, &caps); err != nil {
		return err
	}
	if caps.Protocol != RetentionAdapterProtocol || caps.Mode != "visibility_only" {
		return ErrRetentionAdapter
	}
	return nil
}

func (a *RetentionHTTPAdapter) Snapshot(ctx context.Context, groupID string) (media.RetentionSnapshot, error) {
	id, err := uuid.Parse(groupID)
	if err != nil {
		return media.RetentionSnapshot{}, ErrRetentionAdapter
	}
	var snapshot media.RetentionSnapshot
	if err := a.call(ctx, "GET", "/internal/retention/snapshot?groupId="+strings.ReplaceAll(id.String(), "-", ""), nil, &snapshot); err != nil {
		return snapshot, err
	}
	if snapshot.ConversationID != "sg_"+strings.ReplaceAll(id.String(), "-", "") || !snapshot.Complete ||
		snapshot.SessionType != "group" || snapshot.SnapshotID == "" {
		return media.RetentionSnapshot{}, ErrRetentionAdapter
	}
	if _, err := uuid.Parse(snapshot.SnapshotID); err != nil {
		return media.RetentionSnapshot{}, ErrRetentionAdapter
	}
	if _, err := media.PlanGroupRetention(snapshot); err != nil {
		return media.RetentionSnapshot{}, ErrRetentionAdapter
	}
	return snapshot, nil
}

func (a *RetentionHTTPAdapter) ApplyPrefix(ctx context.Context, job repository.RetentionApplication, boundary int64) error {
	expected, err := media.RetentionMinSeq(job.Plan)
	if err != nil || expected != boundary || boundary <= 0 || job.Plan.SnapshotID == "" ||
		job.Plan.ConversationID != "sg_"+strings.ReplaceAll(job.GroupID, "-", "") {
		return ErrRetentionAdapter
	}
	var result struct {
		Protocol       string `json:"protocol"`
		ConversationID string `json:"conversationId"`
		MinVisibleSeq  int64  `json:"minVisibleSeq"`
	}
	if err := a.call(ctx, "POST", "/internal/retention/apply", map[string]any{
		"snapshotId": job.Plan.SnapshotID, "conversationId": job.Plan.ConversationID, "minVisibleSeq": boundary,
	}, &result); err != nil {
		return err
	}
	if result.Protocol != RetentionAdapterProtocol || result.ConversationID != job.Plan.ConversationID || result.MinVisibleSeq < boundary || result.MinVisibleSeq >= 1<<53 {
		return ErrRetentionAdapter
	}
	return nil
}
