package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/infra"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"

	"github.com/google/uuid"
)

var (
	ErrForwardInvalidRequest = errors.New("invalid forward request")
	ErrForwardUnavailable    = errors.New("forward service unavailable")
)

// 单次 HTTP 请求只控制写库批次大小，不限制一个任务最终可以包含多少目标。
const maxForwardTargetWriteBatch = 1000

type ForwardService struct {
	Repo   *repository.ForwardRepo
	Client *im.Client
	Kafka  *infra.KafkaProducer
}

type CreateForwardInput struct {
	SourceMessageID      string
	SourceConversationID string
	SourceClientMsgID    string
	SourceServerMsgID    string
	SourceSnapshot       models.ForwardMessageSnapshot
	Selector             models.ForwardSelector
	IdempotencyKey       string
	TargetUserIDs        []string
}

func (s *ForwardService) Create(ctx context.Context, userID string, in CreateForwardInput) (models.ForwardTask, error) {
	if s.Repo == nil {
		return models.ForwardTask{}, ErrForwardUnavailable
	}
	if err := validateForwardSnapshot(in.SourceSnapshot); err != nil {
		return models.ForwardTask{}, err
	}
	if in.SourceClientMsgID == "" && in.SourceMessageID == "" {
		return models.ForwardTask{}, fmt.Errorf("%w: sourceClientMsgId is required", ErrForwardInvalidRequest)
	}
	if strings.TrimSpace(in.IdempotencyKey) == "" {
		in.IdempotencyKey = uuid.NewString()
	}
	if len(in.IdempotencyKey) > 128 {
		return models.ForwardTask{}, fmt.Errorf("%w: idempotencyKey is too long", ErrForwardInvalidRequest)
	}
	if err := validateForwardUUIDs(in.TargetUserIDs, "targetUserIds"); err != nil {
		return models.ForwardTask{}, err
	}

	task, err := s.Repo.CreateTask(ctx, repository.CreateForwardTaskParams{
		UserID:               userID,
		SourceMessageID:      in.SourceMessageID,
		SourceConversationID: in.SourceConversationID,
		SourceClientMsgID:    in.SourceClientMsgID,
		SourceServerMsgID:    in.SourceServerMsgID,
		Snapshot:             in.SourceSnapshot,
		Selector:             in.Selector,
		IdempotencyKey:       in.IdempotencyKey,
	})
	if err != nil {
		return models.ForwardTask{}, err
	}
	// 相同幂等键若已进入执行阶段，直接返回原任务，不再次修改目标集合。
	if task.Status != models.ForwardTaskDraft {
		return task, nil
	}
	for start := 0; start < len(in.TargetUserIDs); start += maxForwardTargetWriteBatch {
		end := min(start+maxForwardTargetWriteBatch, len(in.TargetUserIDs))
		if _, err := s.Repo.AddTargets(ctx, userID, task.ID, in.TargetUserIDs[start:end]); err != nil {
			return models.ForwardTask{}, err
		}
	}
	return s.Repo.GetTask(ctx, userID, task.ID)
}

func validateForwardSnapshot(snapshot models.ForwardMessageSnapshot) error {
	if snapshot.ContentType <= 0 {
		return fmt.Errorf("%w: sourceSnapshot.contentType is required", ErrForwardInvalidRequest)
	}
	// OpenIM 1000 及以上为通知/控制消息，不允许客户端借转发接口伪造。
	if snapshot.ContentType >= 1000 {
		return fmt.Errorf("%w: notification messages cannot be forwarded", ErrForwardInvalidRequest)
	}
	if len(snapshot.Content) == 0 || !json.Valid(snapshot.Content) {
		return fmt.Errorf("%w: sourceSnapshot.content must be valid JSON", ErrForwardInvalidRequest)
	}
	var content any
	if err := json.Unmarshal(snapshot.Content, &content); err != nil || content == nil {
		return fmt.Errorf("%w: sourceSnapshot.content must not be null", ErrForwardInvalidRequest)
	}
	return nil
}

func (s *ForwardService) Get(ctx context.Context, userID, taskID string) (models.ForwardTask, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return models.ForwardTask{}, err
	}
	return s.Repo.GetTask(ctx, userID, taskID)
}

func (s *ForwardService) List(ctx context.Context, userID, status, cursor string, limit int) (models.ForwardTaskPage, error) {
	if status != "" && !validForwardTaskStatus(status) {
		return models.ForwardTaskPage{}, fmt.Errorf("%w: invalid status", ErrForwardInvalidRequest)
	}
	if cursor != "" {
		if _, err := uuid.Parse(cursor); err != nil {
			return models.ForwardTaskPage{}, fmt.Errorf("%w: invalid cursor", ErrForwardInvalidRequest)
		}
	}
	return s.Repo.ListTasks(ctx, userID, status, cursor, limit)
}

func (s *ForwardService) AddTargets(ctx context.Context, userID, taskID string, userIDs []string) (int64, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return 0, err
	}
	if len(userIDs) == 0 || len(userIDs) > maxForwardTargetWriteBatch {
		return 0, fmt.Errorf("%w: taskId and 1-%d targetUserIds are required", ErrForwardInvalidRequest, maxForwardTargetWriteBatch)
	}
	if err := validateForwardUUIDs(userIDs, "targetUserIds"); err != nil {
		return 0, err
	}
	return s.Repo.AddTargets(ctx, userID, taskID, uniqueStrings(userIDs))
}

func (s *ForwardService) GenerateTargets(ctx context.Context, userID, taskID string, selector models.ForwardSelector) (int64, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return 0, err
	}
	if selector.Mode == "" {
		selector.Mode = "all_friends"
	}
	if selector.Mode != "all_friends" && selector.Mode != "tags" && selector.Mode != "search" {
		return 0, fmt.Errorf("%w: invalid selector.mode", ErrForwardInvalidRequest)
	}
	if selector.Mode == "tags" && len(selector.TagIDs) == 0 {
		return 0, fmt.Errorf("%w: selector.tagIds is required", ErrForwardInvalidRequest)
	}
	if err := validateForwardUUIDs(selector.TagIDs, "selector.tagIds"); err != nil {
		return 0, err
	}
	return s.Repo.GenerateTargets(ctx, userID, taskID, selector)
}

func (s *ForwardService) RemoveTargets(ctx context.Context, userID, taskID string, userIDs []string) (int64, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return 0, err
	}
	if len(userIDs) == 0 || len(userIDs) > maxForwardTargetWriteBatch {
		return 0, fmt.Errorf("%w: taskId and 1-%d targetUserIds are required", ErrForwardInvalidRequest, maxForwardTargetWriteBatch)
	}
	if err := validateForwardUUIDs(userIDs, "targetUserIds"); err != nil {
		return 0, err
	}
	return s.Repo.RemoveTargets(ctx, userID, taskID, uniqueStrings(userIDs))
}

func (s *ForwardService) ClearTargets(ctx context.Context, userID, taskID string) (int64, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return 0, err
	}
	return s.Repo.ClearTargets(ctx, userID, taskID)
}

func (s *ForwardService) ListTargets(ctx context.Context, userID, taskID, status, cursor string, limit int) (models.ForwardTargetPage, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return models.ForwardTargetPage{}, err
	}
	if status != "" && !validForwardTargetStatus(status) {
		return models.ForwardTargetPage{}, fmt.Errorf("%w: invalid status", ErrForwardInvalidRequest)
	}
	if cursor != "" {
		if _, err := uuid.Parse(cursor); err != nil {
			return models.ForwardTargetPage{}, fmt.Errorf("%w: invalid cursor", ErrForwardInvalidRequest)
		}
	}
	return s.Repo.ListTargets(ctx, userID, taskID, status, cursor, limit)
}

func (s *ForwardService) Submit(ctx context.Context, userID, taskID string) error {
	if err := validateForwardTaskID(taskID); err != nil {
		return err
	}
	if s.Kafka == nil || !s.Kafka.Available() {
		return fmt.Errorf("%w: kafka is not configured", ErrForwardUnavailable)
	}
	return s.Repo.SubmitTask(ctx, userID, taskID)
}

func (s *ForwardService) Cancel(ctx context.Context, userID, taskID, reason string) error {
	if err := validateForwardTaskID(taskID); err != nil {
		return err
	}
	return s.Repo.CancelTask(ctx, userID, taskID, reason)
}

func (s *ForwardService) Pause(ctx context.Context, userID, taskID string) error {
	if err := validateForwardTaskID(taskID); err != nil {
		return err
	}
	return s.Repo.PauseTask(ctx, userID, taskID)
}

func (s *ForwardService) Resume(ctx context.Context, userID, taskID string) error {
	if err := validateForwardTaskID(taskID); err != nil {
		return err
	}
	if s.Kafka == nil || !s.Kafka.Available() {
		return fmt.Errorf("%w: kafka is not configured", ErrForwardUnavailable)
	}
	return s.Repo.ResumeTask(ctx, userID, taskID)
}

func (s *ForwardService) Retry(ctx context.Context, userID, taskID string, onlyFailed bool, userIDs []string) (int64, error) {
	if err := validateForwardTaskID(taskID); err != nil {
		return 0, err
	}
	if s.Kafka == nil || !s.Kafka.Available() {
		return 0, fmt.Errorf("%w: kafka is not configured", ErrForwardUnavailable)
	}
	if len(userIDs) > maxForwardTargetWriteBatch {
		return 0, fmt.Errorf("%w: invalid taskId or too many targetUserIds", ErrForwardInvalidRequest)
	}
	if err := validateForwardUUIDs(userIDs, "targetUserIds"); err != nil {
		return 0, err
	}
	if userIDs == nil {
		userIDs = []string{}
	}
	return s.Repo.RetryTask(ctx, userID, taskID, onlyFailed, uniqueStrings(userIDs))
}

func uniqueStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, exists := seen[item]; exists {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func validateForwardTaskID(taskID string) error {
	if _, err := uuid.Parse(taskID); err != nil {
		return fmt.Errorf("%w: invalid taskId", ErrForwardInvalidRequest)
	}
	return nil
}

func validateForwardUUIDs(items []string, field string) error {
	for _, item := range items {
		if _, err := uuid.Parse(strings.TrimSpace(item)); err != nil {
			return fmt.Errorf("%w: %s contains invalid user ID", ErrForwardInvalidRequest, field)
		}
	}
	return nil
}

func validForwardTaskStatus(status string) bool {
	switch status {
	case models.ForwardTaskDraft, models.ForwardTaskExpanding, models.ForwardTaskPending,
		models.ForwardTaskProcessing, models.ForwardTaskCompleted, models.ForwardTaskPartiallyCompleted,
		models.ForwardTaskFailed, models.ForwardTaskPaused, models.ForwardTaskCancelled:
		return true
	default:
		return false
	}
}

func validForwardTargetStatus(status string) bool {
	switch status {
	case models.ForwardTargetPending, models.ForwardTargetProcessing, models.ForwardTargetRetrying,
		models.ForwardTargetSuccess, models.ForwardTargetFailed, models.ForwardTargetSkipped,
		models.ForwardTargetCancelled:
		return true
	default:
		return false
	}
}

type ForwardWorker struct {
	Repo         *repository.ForwardRepo
	Client       *im.Client
	Kafka        *infra.KafkaProducer
	WorkerID     string
	BatchSize    int
	MaxAttempts  int
	Concurrency  int
	QPS          int
	PollInterval time.Duration
	LockTTL      time.Duration
}

func (w *ForwardWorker) normalize() {
	if w.WorkerID == "" {
		w.WorkerID = "forward-" + uuid.NewString()
	}
	if w.BatchSize <= 0 {
		w.BatchSize = 50
	}
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 8
	}
	if w.Concurrency <= 0 {
		w.Concurrency = 4
	}
	if w.QPS <= 0 {
		w.QPS = 20
	}
	if w.QPS > 10000 {
		w.QPS = 10000
	}
	if w.BatchSize > 10000 {
		w.BatchSize = 10000
	}
	if w.Concurrency > 256 {
		w.Concurrency = 256
	}
	if w.PollInterval <= 0 {
		w.PollInterval = 2 * time.Second
	}
	if w.LockTTL <= 0 {
		w.LockTTL = 5 * time.Minute
	}
}

func (w *ForwardWorker) Run(ctx context.Context) {
	w.normalize()
	if w.Kafka == nil || !w.Kafka.Available() {
		log.Printf("forward kafka consumer disabled: KAFKA_BROKERS is missing")
		return
	}
	for {
		delivery, err := w.Kafka.FetchForwardTask(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			log.Printf("forward kafka fetch failed: %v", err)
			if !waitContext(ctx, w.PollInterval) {
				return
			}
			continue
		}
		for {
			if err := w.consumeDelivery(ctx, delivery); err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Printf("forward kafka event task=%s failed: %v", delivery.Payload.TaskID, err)
				if !waitContext(ctx, w.PollInterval) {
					return
				}
				continue
			}
			break
		}
	}
}

func (w *ForwardWorker) consumeDelivery(ctx context.Context, delivery infra.ForwardTaskDelivery) error {
	if err := validateForwardTaskID(delivery.Payload.TaskID); err != nil {
		// 非法任务 ID 属于不可恢复的毒消息，直接提交，避免永久阻塞 partition。
		return w.Kafka.CommitForwardTask(ctx, delivery)
	}
	processed, err := w.RunTaskOnce(ctx, delivery.Payload.TaskID)
	if err != nil {
		return err
	}
	task, err := w.Repo.GetTaskForWorker(ctx, delivery.Payload.TaskID)
	if errors.Is(err, repository.ErrForwardTaskNotFound) {
		return w.Kafka.CommitForwardTask(ctx, delivery)
	}
	if err != nil {
		return err
	}
	if task.Status == models.ForwardTaskPending || task.Status == models.ForwardTaskProcessing {
		if task.PendingCount > 0 || task.ProcessingCount > 0 {
			if processed == 0 && !waitContext(ctx, w.PollInterval) {
				return ctx.Err()
			}
			if err := w.Kafka.PublishForwardTask(ctx, infra.ForwardTaskPayload{
				TaskID: task.ID, Reason: "continue",
			}); err != nil {
				return err
			}
		}
	}
	// 先成功发布后继事件，再提交当前 offset；崩溃时最多重复，不会丢批次。
	return w.Kafka.CommitForwardTask(ctx, delivery)
}

func (w *ForwardWorker) RunTaskOnce(ctx context.Context, taskID string) (int, error) {
	w.normalize()
	if w.Repo == nil || w.Client == nil || !w.Client.Available() {
		return 0, ErrForwardUnavailable
	}
	if err := validateForwardTaskID(taskID); err != nil {
		return 0, err
	}
	targets, err := w.Repo.ClaimTaskTargets(ctx, taskID, w.WorkerID, w.BatchSize, w.LockTTL)
	if err != nil || len(targets) == 0 {
		return len(targets), err
	}
	return w.processBatch(ctx, targets)
}

func (w *ForwardWorker) processBatch(ctx context.Context, targets []models.ForwardTarget) (int, error) {

	jobs := make(chan models.ForwardTarget)
	errCh := make(chan error, len(targets))
	interval := time.Second / time.Duration(w.QPS)
	limiter := time.NewTicker(interval)
	defer limiter.Stop()
	var wg sync.WaitGroup
	workers := min(w.Concurrency, len(targets))
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for target := range jobs {
				select {
				case <-ctx.Done():
					errCh <- ctx.Err()
					return
				case <-limiter.C:
				}
				if err := w.processTarget(ctx, target); err != nil {
					errCh <- err
				}
			}
		}()
	}
	for _, target := range targets {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return len(targets), ctx.Err()
		case jobs <- target:
		}
	}
	close(jobs)
	wg.Wait()
	close(errCh)
	var joined error
	for workerErr := range errCh {
		joined = errors.Join(joined, workerErr)
	}
	return len(targets), joined
}

func waitContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

type ForwardOutboxPublisher struct {
	Repo         *repository.ForwardRepo
	Kafka        *infra.KafkaProducer
	WorkerID     string
	BatchSize    int
	PollInterval time.Duration
	LockTTL      time.Duration
}

func (p *ForwardOutboxPublisher) Run(ctx context.Context) {
	if p.Repo == nil || p.Kafka == nil || !p.Kafka.Available() {
		return
	}
	if p.WorkerID == "" {
		p.WorkerID = "forward-outbox-" + uuid.NewString()
	}
	if p.BatchSize <= 0 {
		p.BatchSize = 20
	}
	if p.PollInterval <= 0 {
		p.PollInterval = 2 * time.Second
	}
	if p.LockTTL <= 0 {
		p.LockTTL = time.Minute
	}
	for {
		events, err := p.Repo.ClaimKafkaOutbox(ctx, p.WorkerID, p.BatchSize, p.LockTTL)
		if err != nil {
			log.Printf("forward kafka outbox claim failed: %v", err)
		} else {
			for _, event := range events {
				err := p.Kafka.PublishForwardTask(ctx, infra.ForwardTaskPayload{
					TaskID: event.TaskID, Reason: "submitted",
				})
				if err == nil {
					err = p.Repo.MarkKafkaOutboxPublished(ctx, event)
				}
				if err != nil {
					delay := time.Duration(1<<min(event.Attempts, 8)) * time.Second
					if markErr := p.Repo.MarkKafkaOutboxRetry(ctx, event, err.Error(), time.Now().Add(delay)); markErr != nil {
						log.Printf("forward kafka outbox retry update failed: %v", markErr)
					}
				}
			}
		}
		if !waitContext(ctx, p.PollInterval) {
			return
		}
	}
}

func (w *ForwardWorker) processTarget(ctx context.Context, target models.ForwardTarget) error {
	task, err := w.Repo.GetTaskForWorker(ctx, target.TaskID)
	if err != nil {
		return w.retryOrFail(ctx, target, "task_lookup_failed", err)
	}
	switch task.Status {
	case models.ForwardTaskCancelled:
		return w.Repo.MarkTargetCancelled(ctx, target, "task_cancelled", "task was cancelled")
	case models.ForwardTaskPaused:
		return w.Repo.MarkTargetRetry(ctx, target, "task_paused", "task is paused", time.Now().Add(time.Minute))
	case models.ForwardTaskPending, models.ForwardTaskProcessing:
	default:
		return w.Repo.MarkTargetSkipped(ctx, target, "task_not_runnable", "task is not runnable")
	}

	eligible, reason, err := w.Repo.TargetEligible(ctx, task.UserID, target.TargetUserID)
	if err != nil {
		return w.retryOrFail(ctx, target, "eligibility_check_failed", err)
	}
	if !eligible {
		return w.Repo.MarkTargetSkipped(ctx, target, reason, reason)
	}

	senderIMID, err := im.UserIDFromBusinessID(task.UserID)
	if err != nil {
		return w.Repo.MarkTargetFailed(ctx, target, "invalid_sender_id", err.Error())
	}
	targetIMID, err := im.UserIDFromBusinessID(target.TargetUserID)
	if err != nil {
		return w.Repo.MarkTargetSkipped(ctx, target, "invalid_target_id", err.Error())
	}
	clientMsgID := deterministicForwardClientMsgID(task.ID, target.TargetUserID)
	result, err := w.Client.SendForwardMessage(ctx, senderIMID, targetIMID, clientMsgID,
		task.SourceSnapshot.ContentType, task.SourceSnapshot.Content)
	if err != nil {
		return w.retryOrFail(ctx, target, "openim_send_failed", err)
	}
	conversationID := singleConversationID(senderIMID, targetIMID)
	return w.Repo.MarkTargetSuccess(ctx, target, conversationID, result.ClientMsgID, result.ServerMsgID)
}

func (w *ForwardWorker) retryOrFail(ctx context.Context, target models.ForwardTarget, code string, cause error) error {
	message := cause.Error()
	if target.Attempts >= w.MaxAttempts || !temporaryForwardError(cause) {
		return w.Repo.MarkTargetFailed(ctx, target, code, message)
	}
	delay := time.Duration(1<<min(target.Attempts, 8)) * time.Second
	return w.Repo.MarkTargetRetry(ctx, target, code, message, time.Now().Add(delay))
}

func temporaryForwardError(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var apiErr *im.APIError
	if errors.As(err, &apiErr) {
		return apiErr.HTTPStatus == 0 || apiErr.HTTPStatus == 408 || apiErr.HTTPStatus == 429 || apiErr.HTTPStatus >= 500
	}
	return true
}

func deterministicForwardClientMsgID(taskID, targetUserID string) string {
	sum := sha256.Sum256([]byte(taskID + ":" + targetUserID))
	return "fwd_" + hex.EncodeToString(sum[:16])
}

func singleConversationID(left, right string) string {
	ids := []string{left, right}
	sort.Strings(ids)
	return "si_" + ids[0] + "_" + ids[1]
}
