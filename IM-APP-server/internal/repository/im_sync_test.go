package repository

import (
	"encoding/json"
	"testing"
)

func TestIMGroupUpdatePayloadPreservesEmptyAndFalseValues(t *testing.T) {
	empty := ""
	allow := false
	original := IMGroupUpdatePayload{
		Announcement:         &empty,
		AllowMemberAddFriend: &allow,
	}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var decoded IMGroupUpdatePayload
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Name != nil || decoded.Avatar != nil {
		t.Fatalf("unexpected fields after round trip: %#v", decoded)
	}
	if decoded.Announcement == nil || *decoded.Announcement != "" {
		t.Fatalf("empty announcement was not preserved: %#v", decoded.Announcement)
	}
	if decoded.AllowMemberAddFriend == nil || *decoded.AllowMemberAddFriend {
		t.Fatalf("false allowMemberAddFriend was not preserved: %#v", decoded.AllowMemberAddFriend)
	}
}
