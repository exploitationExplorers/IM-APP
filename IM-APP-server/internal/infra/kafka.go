package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

var ErrKafkaUnavailable = errors.New("kafka is not configured")

// KafkaProducer 同时封装转发任务的同步生产者与 consumer-group reader。
// Writer 默认同步等待 broker ack，Reader 使用显式提交 offset，形成 at-least-once 处理。
type KafkaProducer struct {
	Brokers []string
	Topic   string
	GroupID string

	writer *kafka.Writer
	reader *kafka.Reader
}

func NewKafka(brokersCSV, topic, groupID string) *KafkaProducer {
	brokers := splitCSV(brokersCSV)
	if topic == "" {
		topic = "im-forward-tasks"
	}
	if groupID == "" {
		groupID = "im-forward-workers"
	}
	queue := &KafkaProducer{Brokers: brokers, Topic: topic, GroupID: groupID}
	if len(brokers) == 0 {
		return queue
	}
	queue.writer = &kafka.Writer{
		Addr:                   kafka.TCP(brokers...),
		Topic:                  topic,
		Balancer:               &kafka.Hash{},
		RequiredAcks:           kafka.RequireAll,
		Async:                  false,
		BatchTimeout:           10 * time.Millisecond,
		WriteTimeout:           10 * time.Second,
		AllowAutoTopicCreation: true,
	}
	queue.reader = kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		GroupID:        groupID,
		Topic:          topic,
		MinBytes:       1,
		MaxBytes:       10 << 20,
		CommitInterval: 0,
		StartOffset:    kafka.FirstOffset,
	})
	return queue
}

func (k *KafkaProducer) Available() bool {
	return k != nil && len(k.Brokers) > 0 && k.writer != nil && k.reader != nil
}

type ForwardTaskPayload struct {
	TaskID      string `json:"taskId"`
	Reason      string `json:"reason,omitempty"`
	PublishedAt int64  `json:"publishedAt"`
}

type ForwardTaskDelivery struct {
	Payload ForwardTaskPayload
	message kafka.Message
}

func (k *KafkaProducer) PublishForwardTask(ctx context.Context, payload ForwardTaskPayload) error {
	if !k.Available() {
		return ErrKafkaUnavailable
	}
	if strings.TrimSpace(payload.TaskID) == "" {
		return errors.New("kafka forward taskId is required")
	}
	if payload.PublishedAt == 0 {
		payload.PublishedAt = time.Now().UnixMilli()
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return k.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(payload.TaskID),
		Value: body,
		Time:  time.Now(),
	})
}

func (k *KafkaProducer) FetchForwardTask(ctx context.Context) (ForwardTaskDelivery, error) {
	if !k.Available() {
		return ForwardTaskDelivery{}, ErrKafkaUnavailable
	}
	message, err := k.reader.FetchMessage(ctx)
	if err != nil {
		return ForwardTaskDelivery{}, err
	}
	var payload ForwardTaskPayload
	decodeErr := json.Unmarshal(message.Value, &payload)
	if decodeErr == nil && strings.TrimSpace(payload.TaskID) == "" {
		decodeErr = errors.New("taskId is required")
	}
	if decodeErr != nil {
		// 毒消息无法通过重试修复，提交 offset 后记录错误，避免阻塞整个 partition。
		commitErr := k.reader.CommitMessages(ctx, message)
		if commitErr != nil {
			return ForwardTaskDelivery{}, fmt.Errorf("decode kafka event: %v; commit poison event: %w", decodeErr, commitErr)
		}
		return ForwardTaskDelivery{}, fmt.Errorf("decode kafka forward event: %w", decodeErr)
	}
	return ForwardTaskDelivery{Payload: payload, message: message}, nil
}

func (k *KafkaProducer) CommitForwardTask(ctx context.Context, delivery ForwardTaskDelivery) error {
	if !k.Available() {
		return ErrKafkaUnavailable
	}
	return k.reader.CommitMessages(ctx, delivery.message)
}

func (k *KafkaProducer) Close() error {
	if k == nil {
		return nil
	}
	var joined error
	if k.reader != nil {
		joined = errors.Join(joined, k.reader.Close())
	}
	if k.writer != nil {
		joined = errors.Join(joined, k.writer.Close())
	}
	return joined
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			out = append(out, item)
		}
	}
	return out
}
