package service

import (
	"context"
	"errors"
	"fmt"

	"im-app-server/internal/infra"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ForwardService struct {
	DB     *pgxpool.Pool
	Kafka  *infra.KafkaProducer
}

type ForwardTask struct {
	ID              string `json:"id"`
	Status          string `json:"status"`
	TargetCount     int    `json:"targetCount"`
	DoneCount       int    `json:"doneCount"`
	SourceMessageID string `json:"sourceMessageId"`
}

type CreateForwardInput struct {
	SourceMessageID string
	TargetConvIDs   []string
}

func (s *ForwardService) Create(ctx context.Context, userID string, in CreateForwardInput) (ForwardTask, error) {
	if in.SourceMessageID == "" || len(in.TargetConvIDs) == 0 {
		return ForwardTask{}, errors.New("参数错误")
	}
	if len(in.TargetConvIDs) > 9999 {
		return ForwardTask{}, errors.New("单次转发目标不能超过 9999 个")
	}
	var task ForwardTask
	err := s.DB.QueryRow(ctx, `
		INSERT INTO forward_tasks(user_id, source_message_id, target_count, status)
		VALUES($1::uuid, $2::uuid, $3, 'pending')
		RETURNING id::text, status, target_count, done_count, COALESCE(source_message_id::text,'')`,
		userID, in.SourceMessageID, len(in.TargetConvIDs),
	).Scan(&task.ID, &task.Status, &task.TargetCount, &task.DoneCount, &task.SourceMessageID)
	if err != nil {
		return ForwardTask{}, fmt.Errorf("create forward task: %w", err)
	}
	if s.Kafka != nil {
		_ = s.Kafka.PublishForwardTask(ctx, infra.ForwardTaskPayload{
			TaskID:          task.ID,
			UserID:          userID,
			SourceMessageID: in.SourceMessageID,
			TargetConvIDs:   in.TargetConvIDs,
		})
	}
	return task, nil
}

func (s *ForwardService) Get(ctx context.Context, userID, taskID string) (ForwardTask, error) {
	var task ForwardTask
	err := s.DB.QueryRow(ctx, `
		SELECT id::text, status, target_count, done_count, COALESCE(source_message_id::text,'')
		FROM forward_tasks WHERE id=$1::uuid AND user_id=$2::uuid`,
		taskID, userID,
	).Scan(&task.ID, &task.Status, &task.TargetCount, &task.DoneCount, &task.SourceMessageID)
	if err != nil {
		return ForwardTask{}, errors.New("任务不存在")
	}
	return task, nil
}
