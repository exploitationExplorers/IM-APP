package infra

import (
	"context"
	"encoding/json"
	"log"
)

// KafkaProducer abstracts async task publishing (Phase 5).
// When brokers are empty, tasks are logged locally for dev.
type KafkaProducer struct {
	Brokers []string
	Topic   string
}

func NewKafka(brokersCSV, topic string) *KafkaProducer {
	var brokers []string
	if brokersCSV != "" {
		for _, b := range splitCSV(brokersCSV) {
			if b != "" {
				brokers = append(brokers, b)
			}
		}
	}
	if topic == "" {
		topic = "im-forward-tasks"
	}
	return &KafkaProducer{Brokers: brokers, Topic: topic}
}

func (k *KafkaProducer) Available() bool {
	return k != nil && len(k.Brokers) > 0
}

type ForwardTaskPayload struct {
	TaskID          string   `json:"taskId"`
	UserID          string   `json:"userId"`
	SourceMessageID string   `json:"sourceMessageId"`
	TargetConvIDs   []string `json:"targetConvIds"`
}

func (k *KafkaProducer) PublishForwardTask(ctx context.Context, payload ForwardTaskPayload) error {
	body, _ := json.Marshal(payload)
	if !k.Available() {
		log.Printf("[kafka-dev] topic=%s payload=%s", k.Topic, string(body))
		return nil
	}
	// Production: replace with segmentio/kafka-go or confluent-kafka-go writer.
	log.Printf("[kafka-stub] would publish to %v topic=%s payload=%s", k.Brokers, k.Topic, string(body))
	return nil
}

func splitCSV(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			part := s[start:i]
			out = append(out, part)
			start = i + 1
		}
	}
	return out
}
