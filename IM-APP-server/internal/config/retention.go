package config

import (
	"errors"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// visibility_only expires group history, not its source objects. Physical
// deletion is intentionally NOT a configuration mode.
func (c Config) ValidateRetention() error {
	if c.FavoriteArchiveWorkerEnabled && c.StorageBackend() != "oss" {
		return errors.New("legacy favorite archive worker requires OSS")
	}
	if c.GroupRetentionMode != "off" && c.GroupRetentionMode != "queue_only" && c.GroupRetentionMode != "visibility_only" {
		return errors.New("GROUP_RETENTION_MODE must be off, queue_only or visibility_only; physical cleanup is not supported")
	}
	if c.GroupRetentionMode != "off" {
		if len(c.GroupRetentionGroupIDs) > 100 || (c.GroupRetentionAllGroups && len(c.GroupRetentionGroupIDs) > 0) {
			return errors.New("retention scope must be either up to 100 canonical group UUIDs or explicit all-groups")
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
			return errors.New("visibility_only requires explicit GROUP_RETENTION_GROUP_IDS or GROUP_RETENTION_ALL_GROUPS=true")
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
