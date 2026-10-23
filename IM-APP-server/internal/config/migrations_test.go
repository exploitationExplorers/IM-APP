package config

import "testing"

func TestProductionOSSRejectsMigrationReplayAndDemoSeed(t *testing.T) {
	for _, cfg := range []Config{
		{AppEnvironment: "oss-production"},
		{AppEnvironment: "oss-production", MigrationsMode: "auto"},
		{AppEnvironment: "oss-production", MigrationsMode: "verify", SeedDemo: true},
		{MigrationsMode: "typo"},
	} {
		if cfg.ValidateMigrations() == nil {
			t.Fatal("unsafe migration/seed setting accepted")
		}
	}
	for _, cfg := range []Config{{}, {MigrationsMode: "auto"}, {AppEnvironment: "oss-production", MigrationsMode: "verify"}} {
		if err := cfg.ValidateMigrations(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMigrationModeLoadedFromExplicitProcessEnvironment(t *testing.T) {
	t.Setenv("APP_ENV", "oss-test") // Do not load a developer's .env.
	t.Setenv("MIGRATIONS_MODE", " VERIFY ")
	if cfg := Load(); cfg.MigrationsMode != "verify" {
		t.Fatal("migration setting was not loaded/normalized")
	}
	t.Setenv("MIGRATIONS_MODE", "")
	if cfg := Load(); cfg.MigrationsMode != "auto" {
		t.Fatal("ordinary startup default changed")
	}
}
