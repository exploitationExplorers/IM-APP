package service

import (
	"context"
	"errors"
	"log"
	"time"

	"im-app-server/internal/repository"
)

type PendingFavoriteReader interface {
	PendingMedia(context.Context, string, int) ([]repository.PendingFavorite, error)
}
type ExistingFavoriteArchiver interface {
	ArchiveExisting(context.Context, string, string) error
}

// LegacyFavoriteArchiveWorker copies only legacy persisted favorite snapshots.
// media_archived is the durable progress marker; restarting the scan is safe.
// A bad old URL never starves later rows, and no source file is removed. The
// single Run goroutine owns the transient scan cursor; several replicas may
// safely race via FavoriteService's transaction/CAS and deterministic copies.
type LegacyFavoriteArchiveWorker struct {
	Pending   PendingFavoriteReader
	Archiver  ExistingFavoriteArchiver
	after     string
	nextSweep time.Time
	now       func() time.Time
}

func (w *LegacyFavoriteArchiveWorker) Tick(ctx context.Context) (copied, failed int, err error) {
	if w.Pending == nil || w.Archiver == nil {
		return 0, 0, errors.New("favorite archive worker is not configured")
	}
	now := time.Now
	if w.now != nil {
		now = w.now
	}
	if now().Before(w.nextSweep) {
		return 0, 0, nil
	}
	rows, err := w.Pending.PendingMedia(ctx, w.after, 20)
	if err != nil {
		return 0, 0, err
	}
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return copied, failed, err
		}
		copyCtx, cancel := context.WithTimeout(ctx, 50*time.Second)
		err := w.Archiver.ArchiveExisting(copyCtx, row.UserID, row.Favorite.MessageID)
		cancel()
		if err != nil {
			failed++
		} else {
			copied++
		}
		w.after = row.Favorite.ID
	}
	if len(rows) < 20 {
		w.after = ""
		w.nextSweep = now().Add(time.Hour)
	}
	return copied, failed, nil
}

func (w *LegacyFavoriteArchiveWorker) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		copied, failed, err := w.Tick(ctx)
		if ctx.Err() == nil && (err != nil || copied > 0 || failed > 0) {
			log.Printf("legacy favorite archive pass: copied=%d failed=%d source_deletions=0 scan_error=%t", copied, failed, err != nil)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
