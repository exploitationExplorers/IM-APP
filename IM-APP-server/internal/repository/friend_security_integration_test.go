package repository_test

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
)

const friendCaller = "11111111-1111-4111-8111-111111111111"
const friendTarget = "22222222-2222-4222-8222-222222222222"
const friendOther = "33333333-3333-4333-8333-333333333333"
const friendGroup = "44444444-4444-4444-8444-444444444444"

// 仅接受本次显式配置的隔离本机测试库，不读取应用 DATABASE_URL 或 .env。
func friendTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("IM_APP_FRIEND_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set IM_APP_FRIEND_TEST_DATABASE_URL to isolated localhost friend_test database")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil || u.User.Username() != "friend_test" ||
		(u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") || u.Port() == "" || u.Path != "/imapp_friend_security" {
		t.Fatal("isolated localhost friend_test database required")
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		t.Fatal("invalid test database query")
	}
	for key := range query {
		if key != "sslmode" {
			t.Fatal("database query override forbidden")
		}
	}
	admin, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "friend_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(context.Background(), "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		if err != nil {
			t.Error(err)
		}
	})
	_, err = pool.Exec(context.Background(), `
		CREATE TABLE users(id uuid PRIMARY KEY, phone text NOT NULL DEFAULT '', country_code text NOT NULL DEFAULT '86',
		 public_id text NOT NULL DEFAULT '', password_hash text NOT NULL DEFAULT '', nickname text NOT NULL DEFAULT '',
		 avatar text NOT NULL DEFAULT '', bio text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active',
		 created_at timestamptz NOT NULL DEFAULT now(), password_set boolean NOT NULL DEFAULT false);
		INSERT INTO users(id, public_id) VALUES ('11111111-1111-4111-8111-111111111111','caller'),
		 ('22222222-2222-4222-8222-222222222222','target1234'), ('33333333-3333-4333-8333-333333333333','other');
		CREATE TABLE friendships(user_id uuid, friend_id uuid, PRIMARY KEY(user_id, friend_id));
		CREATE TABLE user_blocks(user_id uuid, blocked_id uuid);
		CREATE TABLE friend_requests(id uuid DEFAULT gen_random_uuid(), from_user uuid, to_user uuid, message text,
		 status text, source text, source_group_id uuid, created_at timestamptz DEFAULT now());
		CREATE UNIQUE INDEX pending_friend_pair ON friend_requests(from_user,to_user) WHERE status='pending';
		CREATE TABLE privacy_settings(user_id uuid PRIMARY KEY, require_friend_approval boolean DEFAULT true,
		 require_group_approval boolean DEFAULT true, updated_at timestamptz DEFAULT now());
		CREATE TABLE app_config_versions(id bigserial, version bigint, status text, data_json text);
		CREATE TABLE im_sync_outbox(aggregate_type text, aggregate_id uuid, event_type text, payload jsonb);
		CREATE TABLE groups(id uuid PRIMARY KEY, public_id text, status text DEFAULT 'active', allow_member_add_friend boolean DEFAULT false);
		CREATE TABLE group_members(group_id uuid, user_id uuid, role text, status text DEFAULT 'active');
		CREATE TABLE user_qrcodes(user_id uuid, token text, revoked_at timestamptz, expires_at timestamptz);
		INSERT INTO user_qrcodes(user_id,token) VALUES('22222222-2222-4222-8222-222222222222','valid-target-qr');
		INSERT INTO groups(id,public_id) VALUES('44444444-4444-4444-8444-444444444444','testgroup');
		INSERT INTO group_members(group_id,user_id,role) VALUES
		 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','member'),
		 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','member');`)
	if err != nil {
		t.Fatal(err)
	}
	ddl, err := os.ReadFile(filepath.Join("..", "..", "migrations", "070_friend_request_security.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := pool.Exec(context.Background(), string(ddl)); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestFriendSecurityPostgresIntegration(t *testing.T) {
	pool := friendTestPool(t)
	ctx := context.Background()
	security := &repository.FriendSecurityRepo{DB: pool}
	contacts := &repository.ContactRepo{DB: pool}
	users := &repository.UserRepo{DB: pool}
	groups := &repository.GroupRepo{DB: pool}
	svc := &service.ContactService{Contacts: contacts, Users: users, Groups: groups, FriendSecurity: security}
	userSvc := &service.UserService{Users: users, Contacts: contacts, Groups: groups, FriendSecurity: security}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	reset := func() {
		exec("TRUNCATE friend_source_grants, friend_request_attempts, friend_requests, friendships, privacy_settings, im_sync_outbox")
	}

	t.Run("source_bound_to_caller_target_type_and_expiry", func(t *testing.T) {
		reset()
		if err := security.Grant(ctx, friendCaller, friendTarget, "public_id"); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct{ from, to, source string }{
			{friendOther, friendTarget, "public_id"}, {friendCaller, friendOther, "public_id"}, {friendCaller, friendTarget, "user_qrcode"},
		} {
			if _, err := security.Resolve(ctx, tc.from, tc.to, tc.source); !errors.Is(err, repository.ErrFriendSourceRequired) {
				t.Fatalf("unexpected authorization: %v", err)
			}
		}
		if source, err := security.Resolve(ctx, friendCaller, friendTarget, ""); err != nil || source != "public_id" {
			t.Fatalf("legacy source: %q %v", source, err)
		}
		exec("UPDATE friend_source_grants SET expires_at=now()-interval '1 second'")
		if _, err := security.Resolve(ctx, friendCaller, friendTarget, "public_id"); !errors.Is(err, repository.ErrFriendSourceRequired) {
			t.Fatalf("expired authorization: %v", err)
		}
	})
	t.Run("generic_profile_never_grants_or_leaks_identifier", func(t *testing.T) {
		reset()
		profile, err := userSvc.GetPublicProfile(ctx, friendCaller, friendTarget, "")
		if err != nil || profile.PublicID == "target1234" {
			t.Fatalf("profile leaked: %+v %v", profile, err)
		}
		if _, err := svc.SendFriendRequest(ctx, friendCaller, friendTarget, "", "", ""); !errors.Is(err, service.ErrFriendSourceRequired) {
			t.Fatalf("UUID-only add accepted: %v", err)
		}
		if _, err := userSvc.GetPublicProfile(ctx, friendCaller, friendTarget, "invalid-group"); err == nil {
			t.Fatal("invalid group accepted")
		}
		if _, err := userSvc.SearchByPublicID(ctx, friendCaller, "target1234"); err != nil {
			t.Fatal(err)
		}
		profile, err = userSvc.GetPublicProfile(ctx, friendCaller, friendTarget, "")
		if err != nil || profile.PublicID != "target1234" {
			t.Fatalf("verified search failed: %+v %v", profile, err)
		}
		result, err := svc.SendFriendRequest(ctx, friendCaller, friendTarget, "", "", "")
		if err != nil || result.Status != "pending" {
			t.Fatalf("safe approval fallback: %+v %v", result, err)
		}
		friend, err := contacts.IsFriend(ctx, friendCaller, friendTarget)
		if err != nil || friend {
			t.Fatal("pending request created friendship")
		}
	})
	t.Run("qr_legacy_request_uses_verified_source", func(t *testing.T) {
		reset()
		if _, err := userSvc.ResolveUserQRCode(ctx, friendCaller, "valid-target-qr"); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SendFriendRequest(ctx, friendCaller, friendTarget, "", "public_id", ""); !errors.Is(err, service.ErrFriendSourceRequired) {
			t.Fatalf("forged source accepted: %v", err)
		}
		if _, err := svc.SendFriendRequest(ctx, friendCaller, friendTarget, "", "", ""); err != nil {
			t.Fatal(err)
		}
		var source string
		if err := pool.QueryRow(ctx, "SELECT source FROM friend_requests").Scan(&source); err != nil || source != "user_qrcode" {
			t.Fatalf("wrong audit source: %q %v", source, err)
		}
	})
	t.Run("explicit_opt_out_preserves_direct_friendship", func(t *testing.T) {
		reset()
		privacy := &repository.PrivacyRepo{DB: pool}
		if _, err := privacy.Update(ctx, friendTarget, models.PrivacySettings{RequireFriendApproval: false, RequireGroupApproval: true}); err != nil {
			t.Fatal(err)
		}
		withPrivacy := *svc
		withPrivacy.Privacy = privacy
		if err := security.Grant(ctx, friendCaller, friendTarget, "public_id"); err != nil {
			t.Fatal(err)
		}
		result, err := withPrivacy.SendFriendRequest(ctx, friendCaller, friendTarget, "", "public_id", "")
		if err != nil || result.Status != "accepted" {
			t.Fatalf("explicit opt-out: %+v %v", result, err)
		}
		for _, pair := range [][2]string{{friendCaller, friendTarget}, {friendTarget, friendCaller}} {
			if ok, err := contacts.IsFriend(ctx, pair[0], pair[1]); err != nil || !ok {
				t.Fatal("missing mutual friendship")
			}
		}
	})
	t.Run("default_privacy_requires_approval", func(t *testing.T) {
		reset()
		withPrivacy := *svc
		withPrivacy.Privacy = &repository.PrivacyRepo{DB: pool}
		if err := security.Grant(ctx, friendCaller, friendTarget, "public_id"); err != nil {
			t.Fatal(err)
		}
		result, err := withPrivacy.SendFriendRequest(ctx, friendCaller, friendTarget, "", "public_id", "")
		if err != nil || result.Status != "pending" {
			t.Fatalf("default approval: %+v %v", result, err)
		}
		if friend, err := contacts.IsFriend(ctx, friendCaller, friendTarget); err != nil || friend {
			t.Fatal("default created friendship")
		}
	})
	t.Run("group_role_and_membership_are_current", func(t *testing.T) {
		reset()
		if _, err := svc.SendGroupFriendRequest(ctx, friendCaller, models.CreateGroupFriendRequest{ToUserID: friendTarget, GroupID: "testgroup"}); !errors.Is(err, service.ErrForbidden) {
			t.Fatalf("forbidden group add: %v", err)
		}
		exec("UPDATE group_members SET role='admin' WHERE user_id=$1", friendCaller)
		if _, err := svc.SendGroupFriendRequest(ctx, friendCaller, models.CreateGroupFriendRequest{ToUserID: friendTarget, GroupID: "testgroup"}); err != nil {
			t.Fatal(err)
		}
		exec("UPDATE group_members SET status='left' WHERE user_id=$1", friendTarget)
		if ok, err := contacts.IsGroupAddFriendAllowed(ctx, friendCaller, friendTarget, friendGroup); err == nil || ok {
			t.Fatal("inactive target allowed")
		}
		if ok, err := contacts.IsGroupAdminOfTarget(ctx, friendCaller, friendTarget, friendGroup); err != nil || ok {
			t.Fatal("inactive target identifier revealed")
		}
		exec("UPDATE group_members SET status='active', role='member'")
	})
	t.Run("concurrent_quota_and_sliding_day_window", func(t *testing.T) {
		reset()
		const requests = 48
		results := make(chan error, requests)
		var wg sync.WaitGroup
		for range requests {
			wg.Add(1)
			go func() { defer wg.Done(); results <- security.Take(ctx, friendCaller) }()
		}
		wg.Wait()
		close(results)
		accepted := 0
		for err := range results {
			if err == nil {
				accepted++
			} else if !errors.Is(err, repository.ErrFriendRateLimited) {
				t.Fatal(err)
			}
		}
		if accepted != repository.FriendRequestsPerMinute {
			t.Fatalf("concurrent accepted %d", accepted)
		}
		if err := security.Take(ctx, friendOther); err != nil {
			t.Fatal("quota crossed accounts", err)
		}
		exec("TRUNCATE friend_request_attempts")
		exec("INSERT INTO friend_request_attempts(user_id,created_at) SELECT $1::uuid, now()-interval '2 minutes' FROM generate_series(1,99)", friendCaller)
		if err := security.Take(ctx, friendCaller); err != nil {
			t.Fatal(err)
		}
		if err := security.Take(ctx, friendCaller); !errors.Is(err, repository.ErrFriendRateLimited) {
			t.Fatalf("day limit: %v", err)
		}
		exec("UPDATE friend_request_attempts SET created_at=now()-interval '25 hours'")
		if err := security.Take(ctx, friendCaller); err != nil {
			t.Fatal("expired window retained", err)
		}
	})
	t.Run("group_and_search_share_account_quota", func(t *testing.T) {
		reset()
		exec("UPDATE group_members SET role='admin' WHERE user_id=$1", friendCaller)
		t.Cleanup(func() { exec("UPDATE group_members SET role='member'") })
		if err := security.Grant(ctx, friendCaller, friendTarget, "public_id"); err != nil {
			t.Fatal(err)
		}
		for range repository.FriendRequestsPerMinute - 1 {
			if err := security.Take(ctx, friendCaller); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := svc.SendGroupFriendRequest(ctx, friendCaller, models.CreateGroupFriendRequest{ToUserID: friendTarget, GroupID: "testgroup"}); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SendFriendRequest(ctx, friendCaller, friendTarget, "", "public_id", ""); !errors.Is(err, service.ErrFriendRateLimited) {
			t.Fatalf("source switch bypassed quota: %v", err)
		}
	})
}
