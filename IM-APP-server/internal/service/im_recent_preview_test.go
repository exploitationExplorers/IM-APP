package service

import (
	"encoding/json"
	"testing"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/models"
)

func TestRecentGroupPreviewAppliesVisibilityBeforeReturningText(t *testing.T) {
	const group = "11111111111141118111111111111111"
	const sender = "22222222222242228222222222222222"
	const cutoff = int64(1795051000000)
	message := func(id string, seq, sent int64) json.RawMessage {
		value, err := json.Marshal(map[string]any{
			"clientMsgID": id, "sendID": sender, "groupID": group, "sessionType": 3, "status": 2,
			"contentType": 101, "seq": seq, "sendTime": sent, "content": map[string]any{"content": id},
		})
		if err != nil {
			t.Fatal(err)
		}
		return json.RawMessage(value)
	}
	item := im.SeqRange{ConversationID: "sg_" + group, Begin: 1, End: 20, Num: 20}
	rows := []json.RawMessage{
		message("before-floor", 8, cutoff+1), message("purged", 12, cutoff),
		message("out-of-range", 21, cutoff+1), message("visible", 20, cutoff+1),
	}
	purges := []models.GroupMessagePurge{{UserID: "22222222-2222-4222-8222-222222222222", PurgedAt: time.UnixMilli(cutoff)}}
	result := recentGroupPreviewMessages(item, rows, 10, purges)
	if len(result) != 1 || result[0].ClientMsgID != "visible" || result[0].Serialized != "" {
		t.Fatalf("visible preview=%+v", result)
	}
}
