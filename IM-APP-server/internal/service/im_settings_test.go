package service

import "testing"

func TestPeerUserIDFromConversation(t *testing.T) {
	owner := "user_owner_with_separator"
	peer := "user_peer_with_separator"
	for _, conversationID := range []string{
		"si_" + owner + "_" + peer,
		"si_" + peer + "_" + owner,
	} {
		got, err := peerUserIDFromConversation(conversationID, owner)
		if err != nil || got != peer {
			t.Fatalf("peerUserIDFromConversation(%q) = %q, %v", conversationID, got, err)
		}
	}
	if _, err := peerUserIDFromConversation("sg_group", owner); err != ErrInvalidConversationSettings {
		t.Fatalf("invalid conversation error = %v", err)
	}
}
