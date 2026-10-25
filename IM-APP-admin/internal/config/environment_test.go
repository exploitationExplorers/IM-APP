package config

import (
	"strings"
	"testing"
)

func testEnvironment() Config {
	return Config{AppEnvironment: "oss-test", DatabaseURL: "postgres://im_oss_test:test@postgres:5432/imapp_oss_test?sslmode=disable", ServerBaseURL: "http://api:8080", ServerInternalKey: strings.Repeat("a", 64), AdminJWTSecret: strings.Repeat("b", 64)}
}

func TestIsolatedEnvironment(t *testing.T) {
	if err := testEnvironment().ValidateEnvironment(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Config){
		func(c *Config) { c.DatabaseURL = "postgres://im@postgres:5432/im_app" },
		func(c *Config) { c.DatabaseURL += "&dbname=im_app" },
		func(c *Config) { c.DatabaseURL += "&host=production" },
		func(c *Config) { c.DatabaseURL += "&user=postgres" },
		func(c *Config) { c.DatabaseURL = strings.ReplaceAll(c.DatabaseURL, "postgres:5432", "prod:5432") },
		func(c *Config) { c.ServerBaseURL = "http://production" },
		func(c *Config) { c.ServerInternalKey = "" },
	} {
		c := testEnvironment()
		change(&c)
		if c.ValidateEnvironment() == nil {
			t.Fatal("accepted unsafe test configuration")
		}
	}
	if err := (Config{}).ValidateEnvironment(); err != nil {
		t.Fatal("changed ordinary mode", err)
	}
}

func TestTestModeSkipsConventionalEnv(t *testing.T) {
	t.Setenv("APP_ENV", "oss-test")
	t.Setenv("DATABASE_URL", "")
	old := fileEnv
	fileEnv = map[string]string{"DATABASE_URL": "postgres://production"}
	t.Cleanup(func() { fileEnv = old })
	if rawEnv("DATABASE_URL") != "" || len(initialFileEnv()) != 0 {
		t.Fatal("test mode read ordinary .env")
	}
}
