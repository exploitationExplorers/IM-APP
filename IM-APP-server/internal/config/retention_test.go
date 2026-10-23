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
}

func retentionTestEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("APP_ENV", "oss-test") // Never load a developer/production .env.
	for _, key := range []string{"GROUP_RETENTION_MODE", "GROUP_RETENTION_GROUP_IDS", "GROUP_RETENTION_ALL_GROUPS", "GROUP_RETENTION_ADAPTER_URL", "GROUP_RETENTION_ADAPTER_KEY"} {
		t.Setenv(key, "")
	}
	t.Setenv("FAVORITE_ARCHIVE_WORKER_ENABLED", "false")
}

func TestRetentionDefaultsEnabledForAllGroups(t *testing.T) {
	retentionTestEnvironment(t)
	c := Load()
	if c.GroupRetentionMode != "visibility_only" || !c.GroupRetentionAllGroups || len(c.GroupRetentionGroupIDs) != 0 {
		t.Fatal("group visibility retention must default on for every group")
	}
	if c.ValidateRetention() == nil {
		t.Fatal("default on must not silently accept a missing private bridge")
	}
	t.Setenv("GROUP_RETENTION_ADAPTER_URL", "http://openim-api:19093")
	t.Setenv("GROUP_RETENTION_ADAPTER_KEY", "a-separate-private-key-at-least-32-bytes")
	if err := Load().ValidateRetention(); err != nil {
		t.Fatal("configured default visibility worker must be valid", err)
	}
}

func TestRetentionExplicitModesOverrideDefault(t *testing.T) {
	for _, mode := range []string{"off", "queue_only"} {
		t.Run(mode, func(t *testing.T) {
			retentionTestEnvironment(t)
			t.Setenv("GROUP_RETENTION_MODE", mode)
			c := Load()
			if c.GroupRetentionMode != mode || c.ValidateRetention() != nil {
				t.Fatal("explicit existing mode must override default without requiring bridge")
			}
		})
	}
}

func TestRetentionDefaultScopeNeverWidensExplicitWhitelist(t *testing.T) {
	retentionTestEnvironment(t)
	t.Setenv("GROUP_RETENTION_ADAPTER_URL", "http://openim-api:19093")
	t.Setenv("GROUP_RETENTION_ADAPTER_KEY", "a-separate-private-key-at-least-32-bytes")
	id := "11111111-1111-4111-8111-111111111111"
	t.Setenv("GROUP_RETENTION_GROUP_IDS", id)
	c := Load()
	if c.GroupRetentionAllGroups || len(c.GroupRetentionGroupIDs) != 1 || c.GroupRetentionGroupIDs[0] != id || c.ValidateRetention() != nil {
		t.Fatal("explicit whitelist must narrow the default scope")
	}
	t.Setenv("GROUP_RETENTION_ALL_GROUPS", "true")
	if Load().ValidateRetention() == nil {
		t.Fatal("explicit all-groups plus whitelist must fail, not expand silently")
	}
	t.Setenv("GROUP_RETENTION_ALL_GROUPS", "false")
	if err := Load().ValidateRetention(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GROUP_RETENTION_GROUP_IDS", "")
	if Load().ValidateRetention() == nil {
		t.Fatal("explicit false with no whitelist must not enable all groups")
	}
}

func TestRetentionMalformedEnvironmentFailsClosed(t *testing.T) {
	for _, scope := range []struct{ ids, all string }{
		{",,,", ""}, {"bad-id", ""}, {"", "treu"},
		{"11111111-1111-4111-8111-111111111111", "treu"},
	} {
		t.Run(scope.ids+"/"+scope.all, func(t *testing.T) {
			retentionTestEnvironment(t)
			t.Setenv("GROUP_RETENTION_ADAPTER_URL", "http://openim-api:19093")
			t.Setenv("GROUP_RETENTION_ADAPTER_KEY", "a-separate-private-key-at-least-32-bytes")
			t.Setenv("GROUP_RETENTION_GROUP_IDS", scope.ids)
			t.Setenv("GROUP_RETENTION_ALL_GROUPS", scope.all)
			if Load().ValidateRetention() == nil {
				t.Fatal("malformed scope must not fall back to every group")
			}
		})
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
