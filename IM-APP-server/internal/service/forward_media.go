package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"im-app-server/internal/media"
	"im-app-server/internal/models"
)

type ForwardMediaRepository interface {
	Get(context.Context, string, string) (models.ForwardMessageSnapshot, error)
	Save(context.Context, string, string, models.ForwardMessageSnapshot) (models.ForwardMessageSnapshot, error)
}

type ForwardMediaArchiver interface {
	PreserveForward(context.Context, string, string, string) (string, error)
}

type ForwardArchiveRepository interface {
	GetTaskForWorker(context.Context, string) (models.ForwardTask, error)
	ArchiveMedia(context.Context, models.ForwardTask, models.ForwardMessageSnapshot) error
}

type ForwardMediaService struct {
	Repo  ForwardMediaRepository
	Media ForwardMediaArchiver
	Guard FavoriteGuard
}

var ErrForwardMedia = errors.New("转发媒体副本保存失败，请稍后重试")

// Preserve is shared by queue submission, legacy queue retries, direct SDK
// forwarding and quote replies. Only the authenticated owner's cache is read.
func (s *ForwardMediaService) Preserve(ctx context.Context, uid string, snapshot models.ForwardMessageSnapshot) (models.ForwardMessageSnapshot, error) {
	if err := validateForwardSnapshot(snapshot); err != nil {
		return models.ForwardMessageSnapshot{}, err
	}
	if err := media.ValidateForwardContent(ctx, snapshot.ContentType, string(snapshot.Content)); err != nil {
		return models.ForwardMessageSnapshot{}, fmt.Errorf("%w: incomplete media snapshot", ErrForwardInvalidRequest)
	}
	urls, err := forwardMediaURLs(ctx, snapshot)
	if err != nil {
		return models.ForwardMessageSnapshot{}, fmt.Errorf("%w: invalid media snapshot", ErrForwardInvalidRequest)
	}
	if len(urls) == 0 {
		return snapshot, nil
	}
	if s == nil || s.Repo == nil || s.Media == nil {
		return models.ForwardMessageSnapshot{}, ErrForwardMedia
	}
	// UseNumber retains 64-bit native IDs. Canonical map order avoids duplicate
	// copies merely because JSON properties were serialized in a different order.
	decoder := json.NewDecoder(bytes.NewReader(snapshot.Content))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return models.ForwardMessageSnapshot{}, ErrForwardInvalidRequest
	}
	canonical, err := json.Marshal(struct {
		Type    int `json:"type"`
		Content any `json:"content"`
	}{snapshot.ContentType, value})
	if err != nil {
		return models.ForwardMessageSnapshot{}, ErrForwardInvalidRequest
	}
	digest := sha256.Sum256(canonical)
	hash := hex.EncodeToString(digest[:])
	var result models.ForwardMessageSnapshot
	action := func(ctx context.Context) error {
		existing, err := s.Repo.Get(ctx, uid, hash)
		if err == nil {
			result = existing
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		content, err := s.Media.PreserveForward(ctx, uid, hash, string(snapshot.Content))
		if err != nil {
			return ErrForwardMedia // No URLs, credentials or source details in errors.
		}
		archived := models.ForwardMessageSnapshot{ContentType: snapshot.ContentType, Content: json.RawMessage(content)}
		if err := validateForwardSnapshot(archived); err != nil {
			return ErrForwardMedia
		}
		if err := media.ValidateForwardContent(ctx, archived.ContentType, content); err != nil {
			return ErrForwardMedia
		}
		result, err = s.Repo.Save(ctx, uid, hash, archived)
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 50*time.Second)
	defer cancel()
	if s.Guard != nil {
		err = s.Guard.WithShared(ctx, action)
	} else {
		err = action(ctx)
	}
	if err != nil {
		return models.ForwardMessageSnapshot{}, ErrForwardMedia
	}
	return result, nil
}

func forwardMediaURLs(ctx context.Context, snapshot models.ForwardMessageSnapshot) ([]string, error) {
	if len(snapshot.Content) > media.MaxContentBytes {
		return nil, media.ErrContent
	}
	// Text and @ text links remain text. Quotes/merged messages can embed media.
	switch snapshot.ContentType {
	case 102, 103, 104, 105, 106, 107, 114:
	default:
		return nil, nil
	}
	var urls []string
	_, _, err := media.RewriteForward(ctx, string(snapshot.Content), func(_ context.Context, raw string) (string, error) {
		urls = append(urls, raw)
		return raw, nil
	})
	if err == nil && snapshot.ContentType >= 102 && snapshot.ContentType <= 105 && len(urls) == 0 {
		err = media.ErrContent // Local-only media must never be marked protected.
	}
	return urls, err
}

// EnsureTask compensates unarchived persisted tasks before any target sends.
// An archive failure leaves the original snapshot/flag unchanged for retry.
func (s *ForwardMediaService) EnsureTask(ctx context.Context, repo ForwardArchiveRepository, task models.ForwardTask) (models.ForwardTask, error) {
	if task.MediaArchived {
		return task, nil
	}
	snapshot, err := s.Preserve(ctx, task.UserID, task.SourceSnapshot)
	if err != nil {
		return models.ForwardTask{}, err
	}
	if err = repo.ArchiveMedia(ctx, task, snapshot); err != nil {
		current, readErr := repo.GetTaskForWorker(ctx, task.ID)
		if readErr == nil && current.MediaArchived {
			return current, nil
		}
		return models.ForwardTask{}, err
	}
	task.SourceSnapshot, task.MediaArchived = snapshot, true
	return task, nil
}
