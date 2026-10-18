package config

import "testing"

func TestRetentionModeFailClosed(t *testing.T) {
	if err := (Config{GroupRetentionMode: "off", StorageProvider: "minio", FavoriteArchiveWorkerEnabled: true}).ValidateRetention(); err == nil {
		t.Fatal("invalid worker storage must fail before database startup")
	}
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
	if err := (Config{GroupRetentionMode: "visibility_only"}).ValidateRetention(); err == nil {
		t.Fatal("visibility mode requires explicit private adapter configuration")
	}
	if err := (Config{GroupRetentionMode: "visibility_only", GroupRetentionAllGroups: true, GroupRetentionAdapterURL: "http://openim-api:19093", GroupRetentionAdapterKey: "a-separate-private-key-at-least-32-bytes"}).ValidateRetention(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_ENV", "oss-test")
	t.Setenv("GROUP_RETENTION_MODE", "")
	if Load().GroupRetentionMode != "off" {
		t.Fatal("retention must default off")
	}
}

func TestRetentionRequiresExplicitVisibilityScope(t *testing.T) {
	c := Config{GroupRetentionMode: "visibility_only", GroupRetentionAdapterURL: "http://openim-api:19093", GroupRetentionAdapterKey: "a-separate-private-key-at-least-32-bytes"}
	if c.ValidateRetention() == nil {
		t.Fatal("missing scope silently enabled every group")
	}
	c.GroupRetentionGroupIDs = []string{"11111111-1111-4111-8111-111111111111"}
	if err := c.ValidateRetention(); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{{"sg_11111111111141118111111111111111"}, {"11111111111141118111111111111111"}, {"ABCDEFAB-1111-4111-8111-111111111111"}, {"11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"}} {
		c.GroupRetentionGroupIDs = ids
		if c.ValidateRetention() == nil {
			t.Fatal("unsafe/ambiguous scope accepted")
		}
	}
	c.GroupRetentionGroupIDs = []string{"11111111-1111-4111-8111-111111111111"}
	c.GroupRetentionAllGroups = true
	if c.ValidateRetention() == nil {
		t.Fatal("both whitelist and all-groups accepted")
	}
	c.GroupRetentionGroupIDs = nil
	if err := c.ValidateRetention(); err != nil {
		t.Fatal(err)
	}
}
