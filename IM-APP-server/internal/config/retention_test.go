package config

import "testing"

func TestRetentionModeFailClosed(t *testing.T) {
	for _, mode := range []string{"off", "queue_only"} {
		if err := (Config{GroupRetentionMode: mode}).ValidateRetention(); err != nil {
			t.Fatal(err)
		}
	}
	for _, mode := range []string{"apply", "cleanup", "preview", "true", ""} {
		if err := (Config{GroupRetentionMode: mode}).ValidateRetention(); err == nil {
			t.Fatalf("unsafe mode accepted: %q", mode)
		}
	}
	t.Setenv("APP_ENV", "oss-test")
	t.Setenv("GROUP_RETENTION_MODE", "")
	if Load().GroupRetentionMode != "off" {
		t.Fatal("retention must default off")
	}
}
