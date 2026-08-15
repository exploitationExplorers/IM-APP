package service

import (
	"encoding/json"
	"testing"

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
