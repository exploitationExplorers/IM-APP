// archive-favorites compensates legacy favorites without touching source
// messages/files. Preview is the default; -apply copies and updates snapshots.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/google/uuid"
	"im-app-server/internal/config"
	"im-app-server/internal/db"
	"im-app-server/internal/infra"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
)

func run() error {
	apply := flag.Bool("apply", false, "copy legacy media and commit archived favorite snapshots")
	after := flag.String("after", "", "resume strictly after this favorite UUID")
	limit := flag.Int("limit", 100, "maximum records per invocation, including failures")
	flag.Parse()
	if *limit < 1 || *limit > 10000 {
		return fmt.Errorf("limit must be between 1 and 10000")
	}
	if *after != "" {
		if _, err := uuid.Parse(*after); err != nil {
			return fmt.Errorf("invalid after UUID")
		}
	}
	// An operator must name the intended database explicitly. No fallback to a
	// developer/production .env DATABASE_URL, and no migration replay or seeding.
	databaseURL := os.Getenv("MEDIA_ARCHIVE_DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("MEDIA_ARCHIVE_DATABASE_URL must explicitly name the intended database")
	}
	cfg := config.Load()
	cfg.DatabaseURL = databaseURL
	if err := cfg.ValidateStorage(); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	pool, err := db.Connect(databaseURL)
	if err != nil {
		return fmt.Errorf("could not connect to archive database")
	}
	defer pool.Close()
	if err := db.RequireColumns(ctx, pool, map[string][]string{"favorites": {"media_archived"}}); err != nil {
		return err
	}
	repo := &repository.FavoriteRepo{DB: pool}
	svc := &service.FavoriteService{Fav: repo, Guard: &repository.MediaGuard{DB: pool}}
	if *apply {
		if cfg.StorageBackend() != "oss" {
			return fmt.Errorf("archive compensation requires STORAGE_PROVIDER=oss")
		}
		if err := infra.ValidateArchiveSources(cfg.MediaSourcePrefixes); err != nil {
			return err
		}
		storage, err := infra.NewStorage(cfg)
		if err != nil {
			return fmt.Errorf("invalid archive storage configuration")
		}
		svc.Media = infra.NewArchive(storage, infra.SourcePrefixes(cfg.MediaSourcePrefixes, cfg.OpenIM.PublicAPIURL,
			cfg.OSS.MediaProxyURL, cfg.OSS.PublicUploadURL, cfg.OSS.KeyPrefix, cfg.MinIO.PublicURL, cfg.MinIO.Bucket)).
			WithCDNRewrites(cfg.MediaCDNRewrites)
	}
	encoder := json.NewEncoder(os.Stdout)
	processed, failures := 0, 0
	cursor := *after
	for processed < *limit {
		batch, err := repo.PendingMedia(ctx, cursor, min(20, *limit-processed))
		if err != nil {
			return fmt.Errorf("could not read pending favorites")
		}
		if len(batch) == 0 {
			break
		}
		for _, item := range batch {
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("archive interrupted; resume after the last reported cursor")
			}
			status := "pending_preview"
			if *apply {
				if err := svc.ArchiveExisting(ctx, item.UserID, item.Favorite.MessageID); err != nil {
					status = "copy_failed_original_preserved"
					failures++
				} else {
					status = "archived"
				}
			}
			cursor = item.Favorite.ID
			processed++
			if err := encoder.Encode(map[string]any{"favoriteId": cursor, "status": status}); err != nil {
				return err
			}
		}
	}
	if err := encoder.Encode(map[string]any{"apply": *apply, "processed": processed, "failed": failures, "nextAfter": cursor}); err != nil {
		return err
	}
	if failures > 0 {
		return fmt.Errorf("some sources could not be copied; originals retained; rerun from the beginning to retry failures")
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
