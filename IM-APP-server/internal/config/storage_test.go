package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStorageProviderSelection(t *testing.T) {
	if err := (Config{}).ValidateStorage(); err != nil {
		t.Fatal(err)
	}
	if err := (Config{StorageProvider: "unknown"}).ValidateStorage(); err == nil {
		t.Fatal("unknown provider accepted")
	}
	t.Setenv("APP_ENV", "oss-test")
	for _, raw := range []string{"", " ", " OSS "} {
		t.Setenv("STORAGE_PROVIDER", raw)
		if cfg := Load(); cfg.StorageProvider != "oss" || cfg.StorageBackend() != "oss" {
			t.Fatal("OSS must be the default provider")
		}
	}
	t.Setenv("STORAGE_PROVIDER", " MINIO ")
	if cfg := Load(); cfg.StorageProvider != "minio" {
		t.Fatal("explicit MinIO override was ignored")
	}
}

func TestOSSEndpointDefaultsToSelectedRegion(t *testing.T) {
	// Avoid loading a developer's conventional .env while testing defaults.
	t.Setenv("APP_ENV", "oss-test")
	t.Setenv("OSS_ENDPOINT", "")
	for _, region := range []string{"cn-hangzhou", "cn-hongkong"} {
		t.Setenv("OSS_REGION", region)
		cfg := Load()
		if cfg.OSS.Endpoint != "https://oss-"+region+".aliyuncs.com" {
			t.Fatalf("default endpoint does not match region %s", region)
		}
	}
	t.Setenv("OSS_ENDPOINT", "https://custom-storage.example")
	if cfg := Load(); cfg.OSS.Endpoint != "https://custom-storage.example" {
		t.Fatal("explicit OSS endpoint was replaced")
	}
}

func TestOSSTestRejectsProductionDatabaseBeforeStartup(t *testing.T) {
	cfg := Config{AppEnvironment: "oss-test", StorageProvider: "oss", OSS: OSSConfig{KeyPrefix: "oss-test/business/"}}
	for _, dsn := range []string{"", "postgres://im:fake@localhost/im_app", "postgres://im_oss_test:fake@localhost/imapp", "postgres://admin:fake@localhost/imapp_oss_test",
		"postgres://im_oss_test:fake@production:5432/imapp_oss_test",
		"postgres://im_oss_test:fake@localhost:15433/imapp_oss_test?dbname=im_app",
		"postgres://im_oss_test:fake@localhost:15433/imapp_oss_test?host=production",
		"postgres://im_oss_test:fake@localhost:15433/imapp_oss_test?user=admin",
	} {
		cfg.DatabaseURL = dsn
		if err := cfg.ValidateStorage(); err == nil {
			t.Fatal("unsafe test database accepted")
		}
	}
	cfg.DatabaseURL = "postgres://im_oss_test:fake@localhost:15433/imapp_oss_test?sslmode=disable"
	if err := cfg.ValidateStorage(); err != nil {
		t.Fatal(err)
	}
	cfg.OSS.KeyPrefix = "production/"
	if err := cfg.ValidateStorage(); err == nil {
		t.Fatal("test scope bypass")
	}
}

func TestOSSTestRejectsOtherProductionDataTargets(t *testing.T) {
	base := Config{AppEnvironment: "oss-test", StorageProvider: "minio", DatabaseURL: "postgres://im_oss_test:fake@postgres:5432/imapp_oss_test?sslmode=disable"}
	for name, mutate := range map[string]func(*Config){
		"redis":  func(c *Config) { c.RedisURL = "redis://production:6379" },
		"openim": func(c *Config) { c.OpenIM.APIURL = "https://production.example/openim-api" },
		"minio":  func(c *Config) { c.MinIO.Endpoint = "production:9000" },
		"kafka":  func(c *Config) { c.Kafka.Brokers = "production:9092" },
		"sms":    func(c *Config) { c.SMS.SignName = "production" },
	} {
		t.Run(name, func(t *testing.T) {
			c := base
			mutate(&c)
			if c.ValidateStorage() == nil {
				t.Fatal("unsafe test configuration accepted")
			}
		})
	}
}

func TestExplicitOSSTestDoesNotReadConventionalDotEnv(t *testing.T) {
	old, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("REDIS_URL=redis://production:6379\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })
	t.Setenv("APP_ENV", "oss-test")
	t.Setenv("STORAGE_PROVIDER", " OSS ")
	t.Setenv("REDIS_URL", "")
	// Check a key not already present: a normal dotenv load would set it.
	const marker = "IM_APP_OSS_TEST_DOTENV_MARKER"
	t.Setenv(marker, "")
	if err := os.Unsetenv(marker); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(marker+"=must-not-load\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c := Load()
	if c.StorageProvider != "oss" {
		t.Fatal("provider not normalized")
	}
	if _, exists := os.LookupEnv(marker); exists {
		t.Fatal("oss-test read existing server .env")
	}
}
