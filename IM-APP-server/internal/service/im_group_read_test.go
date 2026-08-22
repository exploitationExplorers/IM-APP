package service

import (
	"errors"
	"testing"

	"im-app-server/internal/im"
)

func TestParseGroupConversationID(t *testing.T) {
	businessID := "7f7ed786-822a-4ef3-926f-e357d80ed904"
	imGroupID, err := im.UserIDFromBusinessID(businessID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := parseGroupConversationID("sg_" + imGroupID)
	if err != nil {
		t.Fatal(err)
	}
	if got != businessID {
		t.Fatalf("got %q, want %q", got, businessID)
	}
}

func TestParseGroupConversationIDRejectsNonGroup(t *testing.T) {
	for _, value := range []string{"", "si_x", "sg_", "sg_not-a-uuid"} {
		if _, err := parseGroupConversationID(value); !errors.Is(err, ErrIMInvalidReadStatusRequest) {
			t.Fatalf("%q: got %v", value, err)
		}
	}
}
