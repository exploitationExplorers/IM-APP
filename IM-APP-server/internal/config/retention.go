package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// Default scope is every group; an explicitly supplied whitelist narrows it.
// Never turn a malformed scope into all-groups through a boolean fallback.
func loadRetentionScope() ([]string, bool, error) {
	rawIDs := strings.TrimSpace(os.Getenv("GROUP_RETENTION_GROUP_IDS"))
	ids := splitCSV(rawIDs)
	if rawIDs != "" && len(ids) == 0 {
		return nil, false, errors.New("GROUP_RETENTION_GROUP_IDS must contain canonical group UUIDs")
	}
	all := rawIDs == ""
	if rawAll := strings.TrimSpace(os.Getenv("GROUP_RETENTION_ALL_GROUPS")); rawAll != "" {
		var err error
		all, err = strconv.ParseBool(rawAll)
		if err != nil {
			return ids, false, errors.New("GROUP_RETENTION_ALL_GROUPS must be a boolean")
		}
	}
	return ids, all, nil
}

// visibility_only expires group history, not its source objects. Physical
// deletion is intentionally NOT a business configuration mode.
func (c Config) ValidateRetention() error {
	if c.FavoriteArchiveWorkerEnabled && c.StorageBackend() != "oss" {
		return errors.New("legacy favorite archive worker requires OSS")
	}
	if c.GroupRetentionMode != "off" && c.GroupRetentionMode != "queue_only" && c.GroupRetentionMode != "visibility_only" {
		return errors.New("GROUP_RETENTION_MODE must be off, queue_only or visibility_only; physical cleanup is not supported")
	}
	if c.GroupRetentionMode != "off" {
		if c.retentionScopeError != nil {
			return c.retentionScopeError
		}
		if len(c.GroupRetentionGroupIDs) > 100 || (c.GroupRetentionAllGroups && len(c.GroupRetentionGroupIDs) > 0) {
			return errors.New("retention scope must be either up to 100 canonical group UUIDs or all-groups")
		}
		seen := map[string]bool{}
		for _, id := range c.GroupRetentionGroupIDs {
			u, err := uuid.Parse(id)
			if err != nil || u.String() != id || seen[id] {
				return errors.New("retention scope requires unique canonical business group UUIDs")
			}
			seen[id] = true
		}
	}
	if c.GroupRetentionMode == "visibility_only" {
		if len(c.GroupRetentionGroupIDs) == 0 && !c.GroupRetentionAllGroups {
			return errors.New("visibility_only requires GROUP_RETENTION_GROUP_IDS or GROUP_RETENTION_ALL_GROUPS=true")
		}
		u, err := url.Parse(c.GroupRetentionAdapterURL)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") ||
			u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") ||
			len(c.GroupRetentionAdapterKey) < 32 || strings.ContainsAny(c.GroupRetentionAdapterKey, "\r\n") {
			return errors.New("visibility_only requires a private adapter URL and a separate key of at least 32 bytes")
		}
	}
	return nil
}
