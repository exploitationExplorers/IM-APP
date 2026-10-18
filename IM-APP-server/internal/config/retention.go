package config

import "errors"

// This release supports only off or queue_only. Applying any cleanup requires
// a future trusted adapter, member conversation state and durable client sync.
func (c Config) ValidateRetention() error {
	if c.GroupRetentionMode != "off" && c.GroupRetentionMode != "queue_only" {
		return errors.New("GROUP_RETENTION_MODE must be off or queue_only; cleanup/apply is not supported")
	}
	return nil
}
