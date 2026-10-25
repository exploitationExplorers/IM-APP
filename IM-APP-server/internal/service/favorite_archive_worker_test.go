package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

type pendingFavoriteStub struct {
	after []string
	rows  []repository.PendingFavorite
	err   error
}

func (s *pendingFavoriteStub) PendingMedia(_ context.Context, after string, limit int) ([]repository.PendingFavorite, error) {
	s.after = append(s.after, after)
	if limit != 20 {
		panic("worker must bound each page")
	}
	return s.rows, s.err
}

type existingFavoriteStub struct{ calls []string }

func (s *existingFavoriteStub) ArchiveExisting(_ context.Context, _, msg string) error {
	s.calls = append(s.calls, msg)
	if msg == "bad" {
		return errors.New("sensitive source URL")
	}
	return nil
}

func TestLegacyFavoriteWorkerFailureContinuesAndRescans(t *testing.T) {
	now := time.Now()
	r := &pendingFavoriteStub{rows: []repository.PendingFavorite{{UserID: "owner", Favorite: models.Favorite{ID: "1", MessageID: "bad"}}, {UserID: "owner", Favorite: models.Favorite{ID: "2", MessageID: "good"}}}}
	a := &existingFavoriteStub{}
	w := &LegacyFavoriteArchiveWorker{Pending: r, Archiver: a, now: func() time.Time { return now }}
	copied, failed, err := w.Tick(context.Background())
	if err != nil || copied != 1 || failed != 1 || len(a.calls) != 2 {
		t.Fatal("bad old source starved healthy favorite")
	}
	_, _, _ = w.Tick(context.Background())
	if len(r.after) != 1 {
		t.Fatal("failed source retried too aggressively")
	}
	now = now.Add(time.Hour)
	_, _, _ = w.Tick(context.Background())
	if len(r.after) != 2 || r.after[1] != "" {
		t.Fatal("failed favorites never revisited")
	}
}

func TestLegacyFavoriteWorkerCursorAndCancellation(t *testing.T) {
	r := &pendingFavoriteStub{}
	for i := range 20 {
		r.rows = append(r.rows, repository.PendingFavorite{Favorite: models.Favorite{ID: fmt.Sprint(i), MessageID: fmt.Sprint(i)}})
	}
	w := &LegacyFavoriteArchiveWorker{Pending: r, Archiver: &existingFavoriteStub{}}
	_, _, _ = w.Tick(context.Background())
	r.err = errors.New("database temporarily unavailable")
	_, _, _ = w.Tick(context.Background())
	r.err = nil
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := w.Tick(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if w.after != "19" || r.after[1] != "19" {
		t.Fatal("lost progress on failure/cancel")
	}
}
