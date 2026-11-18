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
