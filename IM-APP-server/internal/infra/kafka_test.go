package infra

import (
	"context"
	"errors"
	"testing"
)

func TestKafkaDisabledWithoutBrokers(t *testing.T) {
	queue := NewKafka("", "", "")
	if queue.Available() {
		t.Fatal("queue should be unavailable without brokers")
	}
	if queue.Topic != "im-forward-tasks" || queue.GroupID != "im-forward-workers" {
		t.Fatalf("unexpected defaults: topic=%q group=%q", queue.Topic, queue.GroupID)
	}
	if err := queue.PublishForwardTask(context.Background(), ForwardTaskPayload{TaskID: "task"}); !errors.Is(err, ErrKafkaUnavailable) {
		t.Fatalf("PublishForwardTask() error = %v", err)
	}
}

func TestKafkaBrokerCSV(t *testing.T) {
	brokers := splitCSV(" broker-1:9092, broker-2:9092 ,,")
	if len(brokers) != 2 || brokers[0] != "broker-1:9092" || brokers[1] != "broker-2:9092" {
		t.Fatalf("unexpected brokers: %#v", brokers)
	}
}
