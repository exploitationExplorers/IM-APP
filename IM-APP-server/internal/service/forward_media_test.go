package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"im-app-server/internal/models"
)

type forwardMediaMemory struct {
	items map[string]models.ForwardMessageSnapshot
	saves int
	fail  bool
}

func (r *forwardMediaMemory) Get(_ context.Context, uid, hash string) (models.ForwardMessageSnapshot, error) {
	if r.fail {
		return models.ForwardMessageSnapshot{}, errors.New("database credential must not escape")
	}
	if v, ok := r.items[uid+hash]; ok {
		return v, nil
	}
	return models.ForwardMessageSnapshot{}, pgx.ErrNoRows
}

func (r *forwardMediaMemory) Save(_ context.Context, uid, hash string, s models.ForwardMessageSnapshot) (models.ForwardMessageSnapshot, error) {
	r.saves++
	if existing, ok := r.items[uid+hash]; ok {
		return existing, nil
	}
	r.items[uid+hash] = s
	return s, nil
}

type forwardMediaCopy struct {
	calls int
	fail  bool
}

func (a *forwardMediaCopy) PreserveForward(_ context.Context, uid, hash, content string) (string, error) {
	a.calls++
	if a.fail {
		return "", errors.New("https://source.example/?secret=must-not-escape")
	}
	return strings.ReplaceAll(content, "chat.example/chat/", "business.example/forwards/"+uid+"/"+hash+"/"), nil
}

func newForwardMediaTest() (*ForwardMediaService, *forwardMediaMemory, *forwardMediaCopy) {
	r := &forwardMediaMemory{items: map[string]models.ForwardMessageSnapshot{}}
	a := &forwardMediaCopy{}
	return &ForwardMediaService{Repo: r, Media: a}, r, a
}

func TestForwardMediaCanonicalCacheAndOwnerIsolation(t *testing.T) {
	s, r, a := newForwardMediaTest()
	first := models.ForwardMessageSnapshot{ContentType: 105, Content: json.RawMessage(`{"sourceUrl":"https://chat.example/chat/a?signature=original%2Bvalue","seq":9007199254740993}`)}
	got, err := s.Preserve(context.Background(), "owner", first)
	if err != nil || !strings.Contains(string(got.Content), "/forwards/owner/") || !strings.Contains(string(got.Content), "9007199254740993") {
		t.Fatal("copy or native integer lost", err)
	}
	reordered := models.ForwardMessageSnapshot{ContentType: 105, Content: json.RawMessage(`{ "seq":9007199254740993, "sourceUrl":"https://chat.example/chat/a?signature=original%2Bvalue" }`)}
	second, err := s.Preserve(context.Background(), "owner", reordered)
	if err != nil || string(second.Content) != string(got.Content) || a.calls != 1 || r.saves != 1 {
		t.Fatal("equivalent retry not cached")
	}
	other, err := s.Preserve(context.Background(), "other", first)
	if err != nil || string(other.Content) == string(got.Content) || a.calls != 2 {
		t.Fatal("owners share saved snapshot")
	}
}

func TestForwardMediaFailureDoesNotPersistOrExposeDetails(t *testing.T) {
	for _, databaseFailure := range []bool{false, true} {
		s, r, a := newForwardMediaTest()
		r.fail, a.fail = databaseFailure, !databaseFailure
		_, err := s.Preserve(context.Background(), "owner", models.ForwardMessageSnapshot{ContentType: 102, Content: json.RawMessage(`{"url":"https://chat.example/chat/a"}`)})
		if !errors.Is(err, ErrForwardMedia) || err.Error() != ErrForwardMedia.Error() || r.saves != 0 {
			t.Fatal("failure saved or leaked details", err)
		}
	}
}

func TestForwardTextLinksNeedNoStorageAndLocalMediaFails(t *testing.T) {
	var s *ForwardMediaService
	for _, snapshot := range []models.ForwardMessageSnapshot{
		{ContentType: 101, Content: json.RawMessage(`{"content":"https://unrelated.example"}`)},
		{ContentType: 114, Content: json.RawMessage(`{"text":"reply","quoteMessage":{"contentType":101,"content":"{\"url\":\"https://unrelated.example\"}","textElem":{"content":"https://unrelated.example"}}}`)},
	} {
		if _, err := s.Preserve(context.Background(), "owner", snapshot); err != nil {
			t.Fatal("plain text required object storage", err)
		}
	}
	for _, kind := range []int{102, 103, 104, 105} {
		if _, err := s.Preserve(context.Background(), "owner", models.ForwardMessageSnapshot{ContentType: kind, Content: json.RawMessage(`{"path":"file:///private/local"}`)}); !errors.Is(err, ErrForwardInvalidRequest) {
			t.Fatal("local media treated as protected", err)
		}
	}
}

func TestForwardIncompleteReferencesFailBeforeCopyOrPersistence(t *testing.T) {
	for _, snapshot := range []models.ForwardMessageSnapshot{
		{ContentType: 104, Content: json.RawMessage(`{"videoUrl":"https://chat.example/chat/video"}`)},
		{ContentType: 114, Content: json.RawMessage(`{"text":"reply","quoteMessage":{"contentType":105,"fileElem":{"filePath":"file:///private/file"}}}`)},
		{ContentType: 107, Content: json.RawMessage(`{"multiMessage":[{"contentType":102,"pictureElem":{"sourcePicture":{"url":"https://chat.example/chat/a"}}},{"ContentType":103,"SoundElem":{"SoundPath":"file:///private/voice"}}]}`)},
	} {
		s, r, a := newForwardMediaTest()
		if _, err := s.Preserve(context.Background(), "owner", snapshot); !errors.Is(err, ErrForwardInvalidRequest) {
			t.Fatal("incomplete reference accepted", err)
		}
		if a.calls != 0 || r.saves != 0 || len(r.items) != 0 {
			t.Fatal("incomplete reference reached archiver or database")
		}
	}
}

type taskArchiveMemory struct {
	task     models.ForwardTask
	writes   int
	conflict bool
}

func (r *taskArchiveMemory) GetTaskForWorker(context.Context, string) (models.ForwardTask, error) {
	return r.task, nil
}
func (r *taskArchiveMemory) ArchiveMedia(_ context.Context, task models.ForwardTask, snapshot models.ForwardMessageSnapshot) error {
	r.writes++
	if r.conflict {
		return errors.New("concurrent update")
	}
	r.task = task
	r.task.SourceSnapshot, r.task.MediaArchived = snapshot, true
	return nil
}

func TestForwardLegacyTaskCompensationAndConcurrentWinner(t *testing.T) {
	s, _, a := newForwardMediaTest()
	before := models.ForwardTask{ID: "task", UserID: "owner", SourceSnapshot: models.ForwardMessageSnapshot{ContentType: 103, Content: json.RawMessage(`{"sourceUrl":"https://chat.example/chat/voice"}`)}}
	r := &taskArchiveMemory{task: before}
	a.fail = true
	if _, err := s.EnsureTask(context.Background(), r, before); err == nil || r.writes != 0 || r.task.MediaArchived {
		t.Fatal("failed copy modified legacy task")
	}
	a.fail = false
	got, err := s.EnsureTask(context.Background(), r, before)
	if err != nil || !got.MediaArchived || strings.Contains(string(got.SourceSnapshot.Content), "chat.example") {
		t.Fatal("legacy task not protected", err)
	}
	r.conflict = true
	winner, err := s.EnsureTask(context.Background(), r, before)
	if err != nil || string(winner.SourceSnapshot.Content) != string(got.SourceSnapshot.Content) {
		t.Fatal("concurrent persisted winner not returned", err)
	}
	calls := a.calls
	if _, err := s.EnsureTask(context.Background(), r, winner); err != nil || a.calls != calls {
		t.Fatal("already saved task was recopied")
	}
}
