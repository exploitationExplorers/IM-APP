package handler

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
)

type voiceStoreStub struct {
	*fileStoreStub
	key, contentType string
	data             []byte
}

func (s *voiceStoreStub) PutObject(_ context.Context, key string, body io.Reader, size int64, contentType string) error {
	s.key, s.contentType = key, contentType
	s.data, _ = io.ReadAll(body)
	if int64(len(s.data)) != size {
		return io.ErrUnexpectedEOF
	}
	return nil
}

func TestVoiceStorageSwitchKeepsMultipartAndResponse(t *testing.T) {
	for _, provider := range []string{"minio", "oss"} {
		t.Run(provider, func(t *testing.T) {
			store := &voiceStoreStub{fileStoreStub: &fileStoreStub{provider: provider, bucket: "fake"}}
			h := &VoiceHandler{Storage: &infra.Storage{Current: store}}
			body := new(bytes.Buffer)
			form := multipart.NewWriter(body)
			file, err := form.CreateFormFile("file", "record.m4a")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = file.Write([]byte("fake-aac-audio"))
			_ = form.Close()
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Set(middleware.ContextUserID, "test-owner")
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/files/voice", body)
			c.Request.Header.Set("Content-Type", form.FormDataContentType())
			h.UploadVoice(c)
			prefix := "voices/test-owner/"
			if provider == "oss" {
				prefix = "oss-test/business/chat/" + prefix
			}
			if w.Code != 200 || !strings.HasPrefix(store.key, prefix) || store.contentType != "audio/mp4" || string(store.data) != "fake-aac-audio" {
				t.Fatalf("voice contract changed: %s", w.Body.String())
			}
			for _, field := range []string{`"url":`, `"size":14`, `"format":"m4a"`} {
				if !strings.Contains(w.Body.String(), field) {
					t.Fatalf("voice response changed: %s", w.Body.String())
				}
			}
		})
	}
}
