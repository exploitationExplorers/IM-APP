package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func testClient(body string, inspect func(*http.Request)) *Client {
	return &Client{Region: "cn-shanghai", AccessKeyID: "test-key", AccessKeySecret: "test-secret", TextService: "chat_detection", ImageService: "baselineCheck",
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if inspect != nil {
				inspect(r)
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}
}

func TestModerationFailsClosed(t *testing.T) {
	for _, tt := range []struct {
		body string
		want error
	}{
		{`{"Code":200,"Data":{"RiskLevel":"none"}}`, nil},
		{`{"Code":200,"Data":{"RiskLevel":"high"}}`, ErrRejected},
		{`{"Code":200,"Data":{"RiskLevel":"low"}}`, ErrRejected},
		{`{"Code":500}`, ErrUnavailable}, {`{"Code":200,"Data":{}}`, ErrUnavailable}, {`invalid`, ErrUnavailable},
	} {
		c := testClient(tt.body, nil)
		if err := c.CheckText(context.Background(), "test"); !errors.Is(err, tt.want) {
			t.Fatalf("%s: %v", tt.body, err)
		}
	}
}

func TestMessagesAcceptWebAndNativeContent(t *testing.T) {
	for _, tt := range []struct {
		name    string
		kind    int
		content string
		images  int
	}{
		{"web text", 101, `{"content":"hello"}`, 0},
		{"native text", 101, `{"TextElem":{"Content":"hello"}}`, 0},
		{"JSON text is not an image", 101, `{"content":"{\"url\":\"https://example.com/page\"}"}`, 0},
		{"web picture", 102, `{"sourcePicture":{"url":"https://media.example/a.png"}}`, 1},
		{"native picture", 102, `{"PictureElem":{"SourcePicture":{"Url":"https://media.example/a.png"}}}`, 1},
		{"native video cover", 104, `{"VideoElem":{"VideoUrl":"https://media.example/a.mp4","SnapshotUrl":"https://media.example/a.png"}}`, 1},
		{"quoted native image", 114, `{"text":"reply","quoteMessage":{"PictureElem":{"SourcePicture":{"Url":"https://media.example/a.png"}}}}`, 1},
		{"merge snapshot", 107, `{"multiMessage":["{\"contentType\":102,\"content\":\"{\\\"sourcePicture\\\":{\\\"url\\\":\\\"https://media.example/a.png\\\"}}\"}"]}`, 1},
	} {
		for _, encoded := range []bool{false, true} {
			t.Run(tt.name+map[bool]string{false: " object", true: " string"}[encoded], func(t *testing.T) {
				images := 0
				c := testClient(`{"Code":200,"Data":{"RiskLevel":"none"}}`, func(r *http.Request) {
					if err := r.ParseForm(); err != nil {
						t.Fatal(err)
					}
					var params map[string]string
					if err := json.Unmarshal([]byte(r.Form.Get("ServiceParameters")), &params); err != nil {
						t.Fatal(err)
					}
					if r.URL.Scheme != "https" || r.URL.Host != "green-cip.cn-shanghai.aliyuncs.com" {
						t.Fatal("wrong endpoint")
					}
					if params["imageUrl"] != "" {
						images++
					}
				})
				raw := json.RawMessage(tt.content)
				if encoded {
					raw, _ = json.Marshal(tt.content)
				}
				if err := c.CheckMessage(context.Background(), tt.kind, raw); err != nil {
					t.Fatal(err)
				}
				if images != tt.images {
					t.Fatalf("checked %d images, want %d", images, tt.images)
				}
			})
		}
	}
}

func TestStoreConfigurationRequiresRealCredentials(t *testing.T) {
	t.Setenv("APP_STORE_READY", "true")
	t.Setenv("CONTENT_MODERATION_ENABLED", "false")
	if _, err := FromEnv(); err == nil {
		t.Fatal("store mode accepted disabled moderation")
	}
	t.Setenv("CONTENT_MODERATION_ENABLED", "true")
	t.Setenv("CONTENT_MODERATION_ACCESS_KEY_ID", "")
	t.Setenv("CONTENT_MODERATION_ACCESS_KEY_SECRET", "")
	if _, err := FromEnv(); err == nil {
		t.Fatal("accepted missing credentials")
	}
	t.Setenv("APP_STORE_READY", "false")
	t.Setenv("CONTENT_MODERATION_ENABLED", "false")
	if c, err := FromEnv(); c != nil || err != nil {
		t.Fatal(c, err)
	}
}

func TestMalformedMediaAndCanceledRequestsCannotPass(t *testing.T) {
	c := testClient(`{"Code":200,"Data":{"RiskLevel":"none"}}`, nil)
	for _, raw := range []string{`null`, `{}`, `invalid`} {
		if err := c.CheckMessage(context.Background(), 102, json.RawMessage(raw)); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	}
	if err := c.CheckImages(context.Background(), []string{"http://media.example/a.png"}); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.CheckText(ctx, "test"); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}
