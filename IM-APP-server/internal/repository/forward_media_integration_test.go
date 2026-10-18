package repository_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
)

type forwardIntegrationArchiver struct{ fail bool }

func (a forwardIntegrationArchiver) PreserveForward(_ context.Context, uid, hash, content string) (string, error) {
	if a.fail {
		return "", errors.New("unavailable")
	}
	return strings.ReplaceAll(content, "chat.example/chat/", "business.example/forwards/"+uid+"/"+hash+"/"), nil
}

func TestForwardMediaPostgresIntegration(t *testing.T) {
	pool := mediaTestPool(t)
	ctx := context.Background()
	for _, name := range []string{"004_forward_tasks.sql", "021_forward_queue.sql", "053_forward_media_preservation.sql", "053_forward_media_preservation.sql"} {
		ddl, err := os.ReadFile(filepath.Join("..", "..", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(ddl)); err != nil {
			t.Fatal(name, err)
		}
	}
	const owner = "11111111-1111-4111-8111-111111111111"
	const other = "22222222-2222-4222-8222-222222222222"
	repo := &repository.ForwardMediaRepo{DB: pool}
	tasks := &repository.ForwardRepo{DB: pool}
	guard := &repository.MediaGuard{DB: pool}
	svc := &service.ForwardMediaService{Repo: repo, Media: forwardIntegrationArchiver{}, Guard: guard}
	source := models.ForwardMessageSnapshot{ContentType: 102, Content: json.RawMessage(`{"sourcePicture":{"url":"https://chat.example/chat/a?signature=test"}}`)}
	t.Run("concurrent_archive_returns_persisted_winner", func(t *testing.T) {
		results := make(chan error, 6)
		var wg sync.WaitGroup
		for range 6 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				got, err := svc.Preserve(ctx, owner, source)
				if err == nil && !strings.Contains(string(got.Content), "/forwards/"+owner+"/") {
					err = errors.New("wrong snapshot")
				}
				results <- err
			}()
		}
		wg.Wait()
		close(results)
		for err := range results {
			if err != nil {
				t.Fatal(err)
			}
		}
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM forward_media_snapshots").Scan(&n); err != nil || n != 1 {
			t.Fatal("duplicate snapshot", err, n)
		}
		if _, err := svc.Preserve(ctx, other, source); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM forward_media_snapshots").Scan(&n); err != nil || n != 2 {
			t.Fatal("cross-owner snapshot", err, n)
		}
	})
	t.Run("repository_save_uses_shared_transaction", func(t *testing.T) {
		want := errors.New("rollback")
		err := guard.WithShared(ctx, func(tx context.Context) error {
			_, err := repo.Save(tx, owner, "rollback", source)
			if err != nil {
				return err
			}
			return want
		})
		if !errors.Is(err, want) {
			t.Fatal(err)
		}
		if _, err := repo.Get(ctx, owner, "rollback"); err == nil {
			t.Fatal("snapshot survived rollback")
		}
	})
	t.Run("old_task_compensation_is_atomic_and_idempotent", func(t *testing.T) {
		task, err := tasks.CreateTask(ctx, repository.CreateForwardTaskParams{UserID: owner, SourceConversationID: "sg_group", SourceClientMsgID: "old-task", Snapshot: source, IdempotencyKey: "old-task"})
		if err != nil {
			t.Fatal(err)
		}
		if task.MediaArchived {
			t.Fatal("old task incorrectly archived")
		}
		archived, err := svc.EnsureTask(ctx, tasks, task)
		if err != nil || !archived.MediaArchived || strings.Contains(string(archived.SourceSnapshot.Content), "chat.example") {
			t.Fatal("old task not compensated", err)
		}
		persisted, err := tasks.GetTask(ctx, owner, task.ID)
		if err != nil || !persisted.MediaArchived {
			t.Fatal("flag not persisted", err)
		}
		if err := tasks.ArchiveMedia(ctx, task, source); !errors.Is(err, repository.ErrForwardTaskState) {
			t.Fatal("stale snapshot overwrote copy", err)
		}
		wrong := task
		wrong.UserID = other
		if err := tasks.ArchiveMedia(ctx, wrong, source); !errors.Is(err, repository.ErrForwardTaskState) {
			t.Fatal("cross-owner task write", err)
		}
		if got, err := svc.EnsureTask(ctx, tasks, task); err != nil || !got.MediaArchived {
			t.Fatal("concurrent compensation failed", err)
		}
	})
	t.Run("copy_failure_leaves_source_and_flag_unchanged", func(t *testing.T) {
		before := models.ForwardMessageSnapshot{ContentType: 105, Content: json.RawMessage(`{"sourceUrl":"https://chat.example/chat/unavailable"}`)}
		task, err := tasks.CreateTask(ctx, repository.CreateForwardTaskParams{UserID: owner, SourceConversationID: "sg_group", SourceClientMsgID: "missing-task", Snapshot: before, IdempotencyKey: "missing-task"})
		if err != nil {
			t.Fatal(err)
		}
		failed := &service.ForwardMediaService{Repo: repo, Media: forwardIntegrationArchiver{fail: true}, Guard: guard}
		if _, err := failed.EnsureTask(ctx, tasks, task); !errors.Is(err, service.ErrForwardMedia) {
			t.Fatal("failure not returned", err)
		}
		got, err := tasks.GetTask(ctx, owner, task.ID)
		if err != nil || got.MediaArchived || !strings.Contains(string(got.SourceSnapshot.Content), "chat.example") {
			t.Fatal("failed source changed", err)
		}
	})
	t.Run("create_failure_never_queues_and_same_key_can_retry", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `ALTER TABLE users ADD COLUMN status text DEFAULT 'active';
			CREATE TABLE friendships(user_id uuid, friend_id uuid)`); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO friendships VALUES($1::uuid,$2::uuid)`, owner, other); err != nil {
			t.Fatal(err)
		}
		failed := &service.ForwardMediaService{Repo: repo, Media: forwardIntegrationArchiver{fail: true}, Guard: guard}
		forward := &service.ForwardService{Repo: tasks, Media: failed}
		input := service.CreateForwardInput{
			SourceConversationID: "sg_group", SourceClientMsgID: "retry-task",
			IdempotencyKey: "retry-task", TargetUserIDs: []string{other},
			SourceSnapshot: models.ForwardMessageSnapshot{ContentType: 105, Content: json.RawMessage(`{"sourceUrl":"https://chat.example/chat/retry-file"}`)},
		}
		if _, err := forward.Create(ctx, owner, input); !errors.Is(err, service.ErrForwardMedia) {
			t.Fatal("copy failure not returned", err)
		}
		draft, err := tasks.GetTaskByIdempotency(ctx, owner, input.IdempotencyKey)
		if err != nil || draft.Status != models.ForwardTaskDraft || draft.MediaArchived || draft.TargetCount != 0 {
			t.Fatal("failed copy created runnable task", err)
		}
		assertOutbox := func(want int) {
			t.Helper()
			var n int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM forward_kafka_outbox WHERE task_id=$1::uuid", draft.ID).Scan(&n); err != nil || n != want {
				t.Fatal("unexpected queue writes", n, err)
			}
		}
		assertOutbox(0)
		if err := forward.Submit(ctx, owner, draft.ID); !errors.Is(err, service.ErrForwardMedia) {
			t.Fatal("submit bypassed failed preservation", err)
		}
		assertOutbox(0)
		forward.Media = svc
		retried, err := forward.Create(ctx, owner, input)
		if err != nil || retried.ID != draft.ID || !retried.MediaArchived || retried.TargetCount != 1 {
			t.Fatal("same-key retry did not protect original task", err)
		}
		if err := forward.Submit(ctx, owner, retried.ID); err != nil {
			t.Fatal("protected task cannot submit", err)
		}
		assertOutbox(1)
		repeated, err := forward.Create(ctx, owner, input)
		if err != nil || repeated.ID != draft.ID || repeated.Status != models.ForwardTaskPending {
			t.Fatal("retry duplicated submitted task", err)
		}
		assertOutbox(1)
	})
	t.Run("completed_legacy_task_replay_does_not_recopy_expired_source", func(t *testing.T) {
		input := service.CreateForwardInput{SourceConversationID: "sg_group", SourceClientMsgID: "completed-task",
			IdempotencyKey: "completed-task", SourceSnapshot: source}
		legacy, err := tasks.CreateTask(ctx, repository.CreateForwardTaskParams{UserID: owner,
			SourceConversationID: input.SourceConversationID, SourceClientMsgID: input.SourceClientMsgID,
			IdempotencyKey: input.IdempotencyKey, Snapshot: source})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "UPDATE forward_tasks SET status='completed' WHERE id=$1::uuid", legacy.ID); err != nil {
			t.Fatal(err)
		}
		forward := &service.ForwardService{Repo: tasks, Media: &service.ForwardMediaService{
			Repo: repo, Media: forwardIntegrationArchiver{fail: true}, Guard: guard}}
		got, err := forward.Create(ctx, owner, input)
		if err != nil || got.ID != legacy.ID || got.Status != models.ForwardTaskCompleted || got.MediaArchived {
			t.Fatal("idempotent replay recopied completed legacy task", err)
		}
	})
}
