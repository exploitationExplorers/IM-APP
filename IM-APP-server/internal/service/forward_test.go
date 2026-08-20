package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"im-app-server/internal/models"
)

func TestValidateForwardSnapshot(t *testing.T) {
	valid := models.ForwardMessageSnapshot{ContentType: 101, Content: json.RawMessage(`{"content":"hello"}`)}
	if err := validateForwardSnapshot(valid); err != nil {
		t.Fatalf("valid snapshot rejected: %v", err)
	}
	for _, snapshot := range []models.ForwardMessageSnapshot{
		{ContentType: 0, Content: json.RawMessage(`{}`)},
		{ContentType: 1001, Content: json.RawMessage(`{}`)},
		{ContentType: 101, Content: json.RawMessage(`null`)},
		{ContentType: 101, Content: json.RawMessage(`{`)},
	} {
		if err := validateForwardSnapshot(snapshot); err == nil {
			t.Fatalf("invalid snapshot accepted: %#v", snapshot)
		}
	}
}

func TestTemporaryForwardErrorsRetryForever(t *testing.T) {
	if !temporaryForwardError(context.DeadlineExceeded) {
		t.Fatal("deadline exceeded must be retried")
	}
	if !temporaryForwardError(errors.New("network unavailable")) {
		t.Fatal("unknown infrastructure errors must be retried conservatively")
	}
}

func TestForwardRetryDelayIsCappedButNeverStops(t *testing.T) {
	if got := forwardRetryDelay(1, 2*time.Second, 5*time.Minute); got != 2*time.Second {
		t.Fatalf("first retry delay = %s", got)
	}
	if got := forwardRetryDelay(1000, 2*time.Second, 5*time.Minute); got != 5*time.Minute {
		t.Fatalf("retry delay cap = %s", got)
	}
}

func TestDeterministicForwardClientMsgID(t *testing.T) {
	first := deterministicForwardClientMsgID("task-1", "user-1")
	second := deterministicForwardClientMsgID("task-1", "user-1")
	other := deterministicForwardClientMsgID("task-1", "user-2")
	if first != second || first == other || len(first) != 36 {
		t.Fatalf("unexpected IDs: first=%q second=%q other=%q", first, second, other)
	}
}

func TestSingleConversationIDIsStable(t *testing.T) {
	if got := singleConversationID("b", "a"); got != "si_a_b" {
		t.Fatalf("singleConversationID() = %q", got)
	}
}
