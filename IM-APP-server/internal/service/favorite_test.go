package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"im-app-server/internal/models"
)

type favoriteRepositoryStub struct {
	value                 *models.Favorite
	creates, archives     int
	lookupErr, archiveErr error
	conflict              *models.Favorite
	archiveWinner         *models.Favorite
}

func (r *favoriteRepositoryStub) GetByMessageID(context.Context, string, string) (models.Favorite, error) {
	if r.lookupErr != nil {
		return models.Favorite{}, r.lookupErr
	}
	if r.value == nil {
		return models.Favorite{}, pgx.ErrNoRows
	}
	return *r.value, nil
}
func (r *favoriteRepositoryStub) Create(_ context.Context, _, message, kind, content, sender, conv string, archived bool) (models.Favorite, error) {
	r.creates++
	if r.conflict != nil {
		r.value = r.conflict
		return *r.value, nil
	}
	r.value = &models.Favorite{ID: "favorite", MessageID: message, Type: kind, Content: content, SenderID: sender, ConversationID: conv, MediaArchived: archived}
	return *r.value, nil
}
func (r *favoriteRepositoryStub) Archive(_ context.Context, _, _, _, content string) error {
	r.archives++
	if r.archiveWinner != nil {
		r.value = r.archiveWinner
	}
	if r.archiveErr != nil {
		return r.archiveErr
	}
	r.value.Content = content
	r.value.MediaArchived = true
	return nil
}
func (r *favoriteRepositoryStub) List(context.Context, string, []string, int, int) ([]models.Favorite, error) {
	return nil, nil
}
func (r *favoriteRepositoryStub) Delete(context.Context, string, string) error {
	r.value = nil
	return nil
}

type archiveStub struct {
	calls  int
	err    error
	active *bool
}

func (a *archiveStub) Preserve(_ context.Context, _, _, _, content string) (string, error) {
	a.calls++
	if a.active != nil && !*a.active {
		return "", errors.New("copy outside shared lock")
	}
	if a.err != nil {
		return "", a.err
	}
	return "copied:" + content, nil
}

type favoriteGuardStub struct {
	calls  int
	active bool
	err    error
}

func (g *favoriteGuardStub) WithShared(ctx context.Context, fn func(context.Context) error) error {
	g.calls++
	if g.err != nil {
		return g.err
	}
	g.active = true
	defer func() { g.active = false }()
	return fn(ctx)
}

func TestFavoriteMediaArchivedBeforeSuccess(t *testing.T) {
	for _, kind := range []string{"image", "video", "voice", "file"} {
		t.Run(kind, func(t *testing.T) {
			r, g := &favoriteRepositoryStub{}, &favoriteGuardStub{}
			a := &archiveStub{active: &g.active}
			s := &FavoriteService{Fav: r, Media: a, Guard: g}
			in := models.CreateFavoriteRequest{MessageID: "message", Type: kind, Content: "original"}
			out, err := s.Create(context.Background(), "user", in)
			if err != nil || !out.MediaArchived || out.Content != "copied:original" || r.creates != 1 || a.calls != 1 || g.calls != 1 {
				t.Fatal("media not independently archived")
			}
			in.Content = "different retry content"
			again, err := s.Create(context.Background(), "user", in)
			if err != nil || again.Content != out.Content || r.creates != 1 || a.calls != 1 {
				t.Fatal("idempotent request changed existing favorite")
			}
		})
	}
}

func TestFavoriteArchiveFailureDoesNotInsert(t *testing.T) {
	want := errors.New("copy failed")
	r := &favoriteRepositoryStub{}
	a := &archiveStub{err: want}
	s := &FavoriteService{Fav: r, Media: a}
	if _, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "message", Type: "image", Content: "source"}); !errors.Is(err, want) || r.creates != 0 || r.value != nil {
		t.Fatal("failed archive persisted successful favorite")
	}
}

func TestFavoriteTextDoesNotDependOnStorage(t *testing.T) {
	for _, kind := range []string{"text", "emoji"} {
		r := &favoriteRepositoryStub{}
		s := &FavoriteService{Fav: r}
		out, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "message", Type: kind, Content: "hello"})
		if err != nil || out.Content != "hello" {
			t.Fatal("text requires storage")
		}
	}
}

func TestFavoriteLegacySnapshotIsArchivedOnRetry(t *testing.T) {
	r := &favoriteRepositoryStub{value: &models.Favorite{ID: "old", MessageID: "message", Type: "voice", Content: `{"path":"https://chat.example/a"}`}}
	a := &archiveStub{}
	s := &FavoriteService{Fav: r, Media: a}
	out, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "message", Type: "image", Content: "untrusted replacement"})
	if err != nil || !out.MediaArchived || out.Type != "voice" || !strings.Contains(out.Content, "chat.example") || strings.Contains(out.Content, "replacement") || r.archives != 1 || r.creates != 0 {
		t.Fatal("legacy favorite not archived from authoritative saved snapshot")
	}
}

func TestFavoriteConcurrentLegacyInsertCannotSkipArchive(t *testing.T) {
	r := &favoriteRepositoryStub{conflict: &models.Favorite{ID: "other", MessageID: "message", Type: "image", Content: "other source"}}
	a := &archiveStub{}
	s := &FavoriteService{Fav: r, Media: a}
	out, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "message", Type: "image", Content: "new source"})
	if err != nil || !out.MediaArchived || out.Content != "copied:other source" || r.archives != 1 {
		t.Fatal("concurrent unarchived favorite returned")
	}
}

func TestFavoriteValidationAndGuardFailure(t *testing.T) {
	for _, in := range []models.CreateFavoriteRequest{
		{Type: "image"}, {MessageID: "a", Type: "unknown"}, {MessageID: "a", Type: "text", Content: strings.Repeat("x", 65537)},
	} {
		r := &favoriteRepositoryStub{}
		s := &FavoriteService{Fav: r}
		if _, err := s.Create(context.Background(), "user", in); err == nil || r.creates != 0 {
			t.Fatal("invalid favorite accepted")
		}
	}
	r, g := &favoriteRepositoryStub{}, &favoriteGuardStub{err: errors.New("lock timeout")}
	s := &FavoriteService{Fav: r, Guard: g}
	if _, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "a", Type: "text"}); err == nil || r.creates != 0 {
		t.Fatal("guard failure ignored")
	}
}

func TestFavoriteLegacyFailureKeepsOriginal(t *testing.T) {
	r := &favoriteRepositoryStub{value: &models.Favorite{ID: "old", MessageID: "a", Type: "image", Content: "original"}}
	s := &FavoriteService{Fav: r, Media: &archiveStub{err: errors.New("source unavailable")}}
	if _, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "a", Type: "image"}); err == nil || r.value.Content != "original" || r.value.MediaArchived || r.archives != 0 {
		t.Fatal("failed legacy archive modified original")
	}
}

func TestArchiveExistingFailureKeepsPersistedSnapshot(t *testing.T) {
	r := &favoriteRepositoryStub{value: &models.Favorite{ID: "old", MessageID: "a", Type: "image", Content: "original"}}
	g := &favoriteGuardStub{}
	a := &archiveStub{err: errors.New("source unavailable"), active: &g.active}
	s := &FavoriteService{Fav: r, Media: a, Guard: g}
	if err := s.ArchiveExisting(context.Background(), "user", "a"); err == nil || r.value.Content != "original" || r.value.MediaArchived || r.archives != 0 || r.creates != 0 || g.calls != 1 {
		t.Fatal("failed compensation changed original snapshot")
	}
}

func TestFavoriteArchiveCASConflictReturnsCommittedSnapshot(t *testing.T) {
	for _, committed := range []bool{true, false} {
		r := &favoriteRepositoryStub{value: &models.Favorite{ID: "old", MessageID: "a", Type: "image", Content: "original"},
			archiveErr: errors.New("CAS conflict"), archiveWinner: &models.Favorite{ID: "old", MessageID: "a", Type: "image", Content: "committed winner", MediaArchived: committed}}
		s := &FavoriteService{Fav: r, Media: &archiveStub{}}
		out, err := s.Create(context.Background(), "user", models.CreateFavoriteRequest{MessageID: "a", Type: "image", Content: "untrusted retry"})
		if committed {
			if err != nil || out.Content != "committed winner" || !out.MediaArchived {
				t.Fatal("speculative snapshot returned instead of CAS winner")
			}
		} else if err == nil {
			t.Fatal("unarchived CAS winner returned as success")
		}
	}
}
