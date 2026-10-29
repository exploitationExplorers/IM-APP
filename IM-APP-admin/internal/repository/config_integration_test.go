package repository

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"im-app-admin/internal/util"
)

// 只允许与服务端集成测试共用的本地一次性数据库，不读取业务 DATABASE_URL。
func privacyConfigTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("IM_APP_MEDIA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated local PostgreSQL required")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil || u.User.Username() != "media_test" ||
		(u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") || u.Port() == "" || u.Path != "/imapp_media_integration" ||
		os.Getenv("IM_APP_MEDIA_TEST_ALLOW_SCHEMA_INIT") != "1" {
		t.Fatal("isolated disposable database required")
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		t.Fatal("invalid database options")
	}
	for key := range q {
		if key != "sslmode" {
			t.Fatal("database option override forbidden")
		}
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("test database connection failed")
	}
	schema := "privacy_config_" + strings.ReplaceAll(util.NewUUID(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		if err != nil {
			t.Error("disposable schema cleanup failed")
		}
	})
	_, err = pool.Exec(ctx, `CREATE TABLE users(id uuid PRIMARY KEY);
		CREATE TABLE app_configs(key text PRIMARY KEY,value text NOT NULL,description text NOT NULL DEFAULT '',
		updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
		CREATE TABLE app_config_versions(id bigserial PRIMARY KEY,version integer NOT NULL UNIQUE,data_json text NOT NULL,
		status text NOT NULL,published_at timestamptz,created_by uuid);
		CREATE TABLE privacy_settings(user_id uuid PRIMARY KEY REFERENCES users(id),
		require_friend_approval boolean NOT NULL,require_group_approval boolean NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
		INSERT INTO users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
		INSERT INTO privacy_settings(user_id,require_friend_approval,require_group_approval)
		VALUES ('11111111-1111-4111-8111-111111111111',false,false);`)
	if err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestPrivacyConfigPublishPostgresIntegration(t *testing.T) {
	pool := privacyConfigTestPool(t)
	ctx := context.Background()
	repo := &OpsRepo{DB: pool}
	operatorID := "99999999-9999-4999-8999-999999999999"
	on, off := true, false
	limits := defaultLimits()
	limits.DefaultRequireFriendApproval = &off
	if err := repo.SaveSystemLimits(ctx, limits, operatorID); err != nil {
		t.Fatal(err)
	}
	// 旧管理客户端没有提交新增字段，保存其他配置不能重置已保存的隐私默认值。
	legacy := defaultLimits()
	legacy.DefaultRequireFriendApproval, legacy.DefaultRequireGroupApproval = nil, nil
	legacy.MaxFileSizeMB = 30
	if err := repo.SaveSystemLimits(ctx, legacy, operatorID); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetSystemLimits(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if *got.DefaultRequireFriendApproval || !*got.DefaultRequireGroupApproval || got.MaxFileSizeMB != 30 {
		t.Fatal("legacy save reset privacy defaults or lost regular fields")
	}
	// 普通发布只修改平台默认值，保留存量用户自行设置的值。
	if err := repo.PublishSystemLimits(ctx, got, operatorID, false); err != nil {
		t.Fatal(err)
	}
	var friend, group bool
	if err := pool.QueryRow(ctx, `SELECT require_friend_approval,require_group_approval FROM privacy_settings
		WHERE user_id='11111111-1111-4111-8111-111111111111'`).Scan(&friend, &group); err != nil {
		t.Fatal(err)
	}
	if friend || group {
		t.Fatal("normal publish overwrote personal settings")
	}
	got.DefaultRequireFriendApproval, got.DefaultRequireGroupApproval = &on, &on
	if err := repo.PublishSystemLimits(ctx, got, operatorID, true); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM privacy_settings WHERE require_friend_approval AND require_group_approval`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("explicit apply failed to update and fill users: %d", count)
	}
	// 批量应用失败时，配置版本也必须一起回滚。
	if _, err := pool.Exec(ctx, `ALTER TABLE privacy_settings ADD CONSTRAINT test_group_approval CHECK (require_group_approval)`); err != nil {
		t.Fatal(err)
	}
	got.DefaultRequireGroupApproval = &off
	if err := repo.PublishSystemLimits(ctx, got, operatorID, true); err == nil {
		t.Fatal("expected batch apply failure")
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM app_config_versions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatal("failed batch apply left a published version")
	}
}
