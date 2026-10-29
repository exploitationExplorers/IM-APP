package repository_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"im-app-server/internal/repository"
)

func TestPrivacyDefaultsPostgresIntegration(t *testing.T) {
	pool := mediaTestPool(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `CREATE TABLE privacy_settings (
		user_id uuid PRIMARY KEY REFERENCES users(id),
		require_friend_approval boolean NOT NULL DEFAULT false,
		require_group_approval boolean NOT NULL DEFAULT false,
		updated_at timestamptz NOT NULL DEFAULT now());
		CREATE TABLE app_configs(key text PRIMARY KEY,value text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
		CREATE TABLE app_config_versions(id bigserial PRIMARY KEY,version integer NOT NULL,data_json text NOT NULL,status text NOT NULL);
		INSERT INTO privacy_settings(user_id) VALUES ('11111111-1111-4111-8111-111111111111');`)
	if err != nil {
		t.Fatal(err)
	}
	runMigrations := func() {
		t.Helper()
		for _, name := range []string{"041_privacy_group_approval_default.sql", "069_privacy_defaults.sql"} {
			sql, err := os.ReadFile(filepath.Join("..", "..", "migrations", name))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, string(sql)); err != nil {
				t.Fatal(err)
			}
		}
	}
	repo := &repository.PrivacyRepo{DB: pool}
	assertSettings := func(uid string, friend, group bool) {
		t.Helper()
		got, err := repo.Get(ctx, uid)
		if err != nil || got.RequireFriendApproval != friend || got.RequireGroupApproval != group {
			t.Fatalf("settings=%+v err=%v, want friend=%v group=%v", got, err, friend, group)
		}
	}
	runMigrations()
	assertSettings("11111111-1111-4111-8111-111111111111", true, true)
	assertSettings("22222222-2222-4222-8222-222222222222", true, true)
	if _, err := pool.Exec(ctx, `UPDATE privacy_settings SET require_friend_approval=false,require_group_approval=false
		WHERE user_id='11111111-1111-4111-8111-111111111111'`); err != nil {
		t.Fatal(err)
	}
	runMigrations()
	assertSettings("11111111-1111-4111-8111-111111111111", false, false)
	if _, err := pool.Exec(ctx, `INSERT INTO app_configs(key,value) VALUES
		('system.limits','{"defaultRequireFriendApproval":false,"defaultRequireGroupApproval":false}');
		INSERT INTO users VALUES ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444')`); err != nil {
		t.Fatal(err)
	}
	// 保存草稿不会影响注册；首次补行使用安全默认值。
	assertSettings("33333333-3333-4333-8333-333333333333", true, true)
	if _, err := pool.Exec(ctx, `INSERT INTO app_config_versions(version,status,data_json) VALUES
		(1,'published','{"defaultRequireFriendApproval":false,"defaultRequireGroupApproval":true}')`); err != nil {
		t.Fatal(err)
	}
	assertSettings("44444444-4444-4444-8444-444444444444", false, true)
	if err := repo.Ensure(ctx, "33333333-3333-4333-8333-333333333333"); err != nil {
		t.Fatal(err)
	}
	assertSettings("33333333-3333-4333-8333-333333333333", true, true)
	if _, err := pool.Exec(ctx, `INSERT INTO app_config_versions(version,status,data_json) VALUES (2,'published','invalid')`); err != nil {
		t.Fatal(err)
	}
	// 平台默认配置损坏时，已保存的个人设置仍可读取。
	assertSettings("33333333-3333-4333-8333-333333333333", true, true)
}
