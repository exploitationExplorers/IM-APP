package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestVerifyModeNeverOpensMigrationDirectoryOrUsesDatabase(t *testing.T) {
	// An absent directory and nil DB deliberately make either replay step fail.
	missing := filepath.Join(t.TempDir(), "unavailable-migrations")
	if err := RunStartupMigrations(context.Background(), nil, missing, "verify"); err != nil {
		t.Fatal(err)
	}
	if err := RunStartupMigrations(context.Background(), nil, missing, "auto"); err == nil {
		t.Fatal("automatic migration mode unexpectedly skipped the directory")
	}
	if err := RunStartupMigrations(context.Background(), nil, missing, "typo"); err == nil {
		t.Fatal("unknown mode silently accepted")
	}
}
