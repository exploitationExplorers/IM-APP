package handler

import (
	"net"
	"testing"
)

func TestParseAllowNets(t *testing.T) {
	networks := parseAllowNets([]string{"127.0.0.1", "10.0.0.0/8", "bad"})
	if len(networks) != 2 {
		t.Fatalf("networks = %d, want 2", len(networks))
	}
	if !networks[0].Contains(net.ParseIP("127.0.0.1")) || networks[0].Contains(net.ParseIP("127.0.0.2")) {
		t.Fatal("single IP allow rule is not /32")
	}
	if !networks[1].Contains(net.ParseIP("10.2.3.4")) || networks[1].Contains(net.ParseIP("11.2.3.4")) {
		t.Fatal("CIDR allow rule is incorrect")
	}
}

func TestWebhookResponse(t *testing.T) {
	if got := allowWebhook(); got.ActionCode != 0 || got.NextCode != 0 || got.ErrCode != 0 {
		t.Fatalf("allow response = %#v", got)
	}
	if got := denyWebhook("blocked"); got.ActionCode != 0 || got.NextCode != 1 || got.ErrCode != 5001 {
		t.Fatalf("deny response = %#v", got)
	}
}
