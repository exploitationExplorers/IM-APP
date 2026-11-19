package im

import (
	"encoding/json"
	"testing"
)

func TestNormalizeRecentMessageText(t *testing.T) {
	raw := json.RawMessage(`{
		"clientMsgID":"m1",
		"sendID":"u1",
		"senderNickname":"张三",
		"contentType":101,
		"sendTime":1700000000000,
		"seq":12,
		"content":"{\"content\":\"你好\"}"
	}`)
	message, ok := NormalizeRecentMessage(raw)
	if !ok {
		t.Fatal("expected message to normalize")
	}
	if message.Preview != "你好" || message.ClientMsgID != "m1" || message.SendID != "u1" || message.Seq != 12 {
		t.Fatalf("unexpected message: %+v", message)
	}
	var serialized map[string]any
	if err := json.Unmarshal([]byte(message.Serialized), &serialized); err != nil {
		t.Fatalf("serialized is not json: %v", err)
	}
	text, ok := serialized["textElem"].(map[string]any)
	if !ok || text["content"] != "你好" {
		t.Fatalf("textElem missing: %+v", serialized)
	}
}

// OpenIM pull_msg_by_seq emits sdkws.MsgData.Content, a []byte in its JSON response.
func TestNormalizeRecentMessageOpenIMByteContent(t *testing.T) {
	const text = "群聊预览：你好 👋"
	content, err := json.Marshal(map[string]string{"content": text})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{
		"clientMsgID": "m1", "sendID": "u1", "groupID": "g1", "sessionType": 3,
		"status": 2, "contentType": 101, "seq": 20, "sendTime": 1700000000000, "content": content,
	})
	if err != nil {
		t.Fatal(err)
	}

	t.Run("group preview", func(t *testing.T) {
		message, ok := NormalizeRecentPreview(raw, "g1")
		if !ok || message.Preview != text || message.Serialized != "" {
			t.Fatalf("preview = %q, accepted = %v", message.Preview, ok)
		}
	})
	t.Run("legacy recent history", func(t *testing.T) {
		message, ok := NormalizeRecentMessage(raw)
		if !ok || message.Preview != text {
			t.Fatalf("preview = %q, accepted = %v", message.Preview, ok)
		}
		var serialized struct {
			TextElem struct{ Content string } `json:"textElem"`
		}
		if err := json.Unmarshal([]byte(message.Serialized), &serialized); err != nil || serialized.TextElem.Content != text {
			t.Fatalf("missing textElem content: %q, error: %v", serialized.TextElem.Content, err)
		}
	})
}

func TestNormalizeRecentMessagePictureObject(t *testing.T) {
	raw := json.RawMessage(`{
		"clientMsgID":"m2",
		"sendID":"u2",
		"contentType":102,
		"sendTime":1700000000000,
		"seq":13,
		"content":{"sourcePicture":{"url":"https://cdn.example/a.jpg"}}
	}`)
	message, ok := NormalizeRecentMessage(raw)
	if !ok {
		t.Fatal("expected message to normalize")
	}
	if message.Preview != "[图片]" {
		t.Fatalf("unexpected preview: %s", message.Preview)
	}
	var serialized map[string]any
	if err := json.Unmarshal([]byte(message.Serialized), &serialized); err != nil {
		t.Fatalf("serialized is not json: %v", err)
	}
	picture, ok := serialized["pictureElem"].(map[string]any)
	if !ok {
		t.Fatalf("pictureElem missing: %+v", serialized)
	}
	source, ok := picture["sourcePicture"].(map[string]any)
	if !ok || source["url"] != "https://cdn.example/a.jpg" {
		t.Fatalf("sourcePicture missing: %+v", picture)
	}
}

func TestNormalizeRecentPreviewRejectsUnsafeContent(t *testing.T) {
	base := map[string]any{
		"clientMsgID": "m1", "sendID": "u1", "groupID": "g1", "sessionType": 3,
		"status": 2, "contentType": 101, "seq": 20, "sendTime": 1700000000000,
		"content": map[string]any{"content": "hello"},
	}
	cases := []struct {
		name  string
		patch map[string]any
		want  bool
	}{
		{name: "ordinary group text", want: true},
		{name: "ordinary group text from OpenIM cache", patch: map[string]any{"status": 1}, want: true},
		{name: "unsequenced message", patch: map[string]any{"status": 1, "seq": 0}},
		{name: "send failed", patch: map[string]any{"status": 3}},
		{name: "revoked", patch: map[string]any{"status": 4}},
		{name: "deleted", patch: map[string]any{"status": 5}},
		{name: "missing status", patch: map[string]any{"status": nil}},
		{name: "direct chat", patch: map[string]any{"sessionType": 1}},
		{name: "wrong group", patch: map[string]any{"groupID": "g2"}},
		{name: "image", patch: map[string]any{"contentType": 102}},
		{name: "private attached info", patch: map[string]any{"attachedInfo": `{"isPrivateChat":true}`}},
		{name: "bad attached info", patch: map[string]any{"attachedInfo": "unparseable"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value := make(map[string]any, len(base))
			for k, v := range base {
				value[k] = v
			}
			for k, v := range tc.patch {
				value[k] = v
			}
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			message, ok := NormalizeRecentPreview(raw, "g1")
			if ok != tc.want || (ok && (message.Preview != "hello" || message.Serialized != "")) {
				t.Fatalf("preview = %+v, accepted = %v", message, ok)
			}
		})
	}
}
