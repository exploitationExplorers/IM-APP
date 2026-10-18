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
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
)

type integrationArchiver struct{ fail bool }

func (a integrationArchiver) Preserve(_ context.Context, _, _, _, content string) (string, error) {
	if a.fail {
		return "", errors.New("source unavailable")
	}
	return "https://business.example/favorites/" + content, nil
}

// Run only against the disposable localhost container created by the test
// runner. Never load conventional DATABASE_URL/.env or the running test stack.
func mediaTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("IM_APP_MEDIA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("run python scripts/test-media-integration.py for isolated PostgreSQL checks")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil || u.User.Username() != "media_test" ||
		(u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") || u.Port() == "" || u.Path != "/imapp_media_integration" ||
		os.Getenv("IM_APP_MEDIA_TEST_ALLOW_SCHEMA_INIT") != "1" {
		t.Fatal("isolated disposable media database required")
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		t.Fatal("invalid test database query")
	}
	for key := range q {
		if key != "sslmode" {
			t.Fatal("database query override forbidden")
		}
	}
	admin, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal("test database connection failed")
	}
	schema := "media_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
			t.Error("disposable schema cleanup failed")
		}
	})
	_, err = pool.Exec(context.Background(), `CREATE TABLE users(id uuid PRIMARY KEY);
	CREATE TABLE favorites (
	 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
	 message_id text NOT NULL, msg_type varchar(16) NOT NULL, content text NOT NULL,
	 sender_id text, conversation_id text, created_at timestamptz NOT NULL DEFAULT now(),
	 UNIQUE(user_id,message_id));
	INSERT INTO users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`)
	if err != nil {
		t.Fatal(err)
	}
	ddl, err := os.ReadFile(filepath.Join("..", "..", "migrations", "052_media_preservation.sql"))
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

func TestFavoriteMediaPostgresIntegration(t *testing.T) {
	pool := mediaTestPool(t)
	ctx := context.Background()
	repo := &repository.FavoriteRepo{DB: pool}
	guard := &repository.MediaGuard{DB: pool}
	const owner = "11111111-1111-4111-8111-111111111111"
	const other = "22222222-2222-4222-8222-222222222222"
	reset := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, "TRUNCATE favorites"); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("rollback_includes_repository_writes", func(t *testing.T) {
		reset()
		want := errors.New("abort")
		err := guard.WithShared(ctx, func(txCtx context.Context) error {
			if _, err := repo.Create(txCtx, owner, "message", "image", "saved", "", "", true); err != nil {
				return err
			}
			return want
		})
		var n int
		_ = pool.QueryRow(ctx, "SELECT count(*) FROM favorites").Scan(&n)
		if !errors.Is(err, want) || n != 0 {
			t.Fatal("archive transaction did not roll back")
		}
	})
	t.Run("copy_failure_no_successful_record", func(t *testing.T) {
		reset()
		svc := &service.FavoriteService{Fav: repo, Guard: guard, Media: integrationArchiver{fail: true}}
		_, err := svc.Create(ctx, owner, models.CreateFavoriteRequest{MessageID: "message", Type: "video", Content: "source"})
		var n int
		_ = pool.QueryRow(ctx, "SELECT count(*) FROM favorites").Scan(&n)
		if err == nil || n != 0 {
			t.Fatal("failed copy persisted success")
		}
	})
	t.Run("concurrent_create_and_legacy_archive", func(t *testing.T) {
		for _, legacy := range []bool{false, true} {
			reset()
			if legacy {
				if _, err := repo.Create(ctx, owner, "message", "image", "source", "", "", false); err != nil {
					t.Fatal(err)
				}
			}
			svc := &service.FavoriteService{Fav: repo, Guard: guard, Media: integrationArchiver{}}
			start := make(chan struct{})
			results := make(chan error, 6)
			var wg sync.WaitGroup
			for range 6 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					out, err := svc.Create(ctx, owner, models.CreateFavoriteRequest{MessageID: "message", Type: "image", Content: "source"})
					if err == nil && (!out.MediaArchived || out.Content != "https://business.example/favorites/source") {
						err = errors.New("uncommitted or wrong snapshot returned")
					}
					results <- err
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			for err := range results {
				if err != nil {
					t.Fatal(err)
				}
			}
			var n int
			_ = pool.QueryRow(ctx, "SELECT count(*) FROM favorites").Scan(&n)
			if n != 1 {
				t.Fatal("duplicate favorites")
			}
		}
	})
	t.Run("stale_cas_and_owner_isolation", func(t *testing.T) {
		reset()
		f, err := repo.Create(ctx, owner, "message", "voice", "source", "", "", false)
		if err != nil {
			t.Fatal(err)
		}
		if err := repo.Archive(ctx, other, f.ID, "source", "stolen"); err == nil {
			t.Fatal("cross-owner archive allowed")
		}
		if err := repo.Archive(ctx, owner, f.ID, "source", "source"); err != nil {
			t.Fatal(err)
		}
		if err := repo.Archive(ctx, owner, f.ID, "source", "replacement"); err == nil {
			t.Fatal("archived snapshot overwritten with stale CAS")
		}
		got, err := repo.GetByMessageID(ctx, owner, "message")
		if err != nil || !got.MediaArchived || got.Content != "source" {
			t.Fatal("CAS changed permanent snapshot")
		}
	})
	t.Run("failed_legacy_source_does_not_starve_next_page", func(t *testing.T) {
		reset()
		_, err := pool.Exec(ctx, `INSERT INTO favorites(id,user_id,message_id,msg_type,content) VALUES
		('00000000-0000-4000-8000-000000000001',$1,'bad','image','broken'),
		('00000000-0000-4000-8000-000000000002',$1,'good','image','source')`, owner)
		if err != nil {
			t.Fatal(err)
		}
		page, err := repo.PendingMedia(ctx, "", 1)
		if err != nil || len(page) != 1 {
			t.Fatal("first page missing")
		}
		svc := &service.FavoriteService{Fav: repo, Guard: guard, Media: integrationArchiver{fail: true}}
		if err := svc.ArchiveExisting(ctx, owner, page[0].Favorite.MessageID); err == nil {
			t.Fatal("failure not reported")
		}
		next, err := repo.PendingMedia(ctx, page[0].Favorite.ID, 1)
		if err != nil || len(next) != 1 || next[0].Favorite.MessageID != "good" {
			t.Fatal("failed source starved later favorites")
		}
		got, err := repo.GetByMessageID(ctx, owner, "bad")
		if err != nil || got.Content != "broken" || got.MediaArchived {
			t.Fatal("failed source modified")
		}
	})
	t.Run("exclusive_maintenance_blocks_archiving_and_releases", func(t *testing.T) {
		err := guard.WithLock(ctx, false, func(context.Context) error {
			blocked, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
			defer cancel()
			if err := guard.WithShared(blocked, func(context.Context) error { return nil }); err == nil {
				return errors.New("shared transaction bypassed exclusive lock")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := guard.WithShared(ctx, func(context.Context) error { return nil }); err != nil {
			t.Fatal("lock not released")
		}
	})
}
