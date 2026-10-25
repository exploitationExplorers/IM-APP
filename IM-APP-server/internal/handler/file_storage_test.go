package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/models"
)

type fileStoreStub struct {
	infra.ObjectStorage
	provider, bucket string
	info             infra.ObjectInfo
	err              error
	statCalls        int
}

func (s *fileStoreStub) Available() bool    { return true }
func (s *fileStoreStub) Provider() string   { return s.provider }
func (s *fileStoreStub) BucketName() string { return s.bucket }
func (s *fileStoreStub) NewKey(key string) (string, error) {
	if s.provider == "oss" {
		return "oss-test/business/" + key, nil
	}
	return key, nil
}
func (s *fileStoreStub) FileURL(key string) string { return "https://test.example/" + key }
func (s *fileStoreStub) Stat(context.Context, string) (infra.ObjectInfo, error) {
	s.statCalls++
	return s.info, s.err
}
func (s *fileStoreStub) PresignPost(_ context.Context, key, _ string, _ time.Duration) (string, map[string]string, error) {
	return "https://upload.example", map[string]string{"key": key, "policy": "fake"}, nil
}

type fileRepoStub struct {
	pending             models.PendingFile
	file                models.FileObject
	creates, readyCalls int
}

func (r *fileRepoStub) CreateFile(_ context.Context, _, purpose, fileName, contentType, key, _, fileURL string, size int64, provider, bucket string) (models.FileObject, error) {
	r.creates++
	r.pending = models.PendingFile{ObjectKey: key, StorageProvider: provider, StorageBucket: bucket, Size: size}
	r.file = models.FileObject{ID: "test-file", Purpose: purpose, FileName: fileName, ContentType: contentType, Size: size, URL: fileURL, Status: "pending"}
	return r.file, nil
}
func (r *fileRepoStub) FindPendingByID(context.Context, string, string) (models.PendingFile, error) {
	return r.pending, nil
}
func (r *fileRepoStub) MarkReady(context.Context, string, string) (models.FileObject, error) {
	r.readyCalls++
	r.file.Status = "ready"
	return r.file, nil
}
func (r *fileRepoStub) FindByID(context.Context, string, string) (models.FileObject, error) {
	return r.file, nil
}

func fileStorageRequest(t *testing.T, handler gin.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.ContextUserID, "test-owner")
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/files/uploads", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	handler(c)
	return w
}

func TestFileUploadContractPreservedForBothProviders(t *testing.T) {
	for _, provider := range []string{"minio", "oss"} {
		t.Run(provider, func(t *testing.T) {
			store := &fileStoreStub{provider: provider, bucket: "test-bucket", info: infra.ObjectInfo{Size: 9}}
			repo := &fileRepoStub{}
			h := &FileHandler{Storage: &infra.Storage{Current: store}, Files: repo}
			w := fileStorageRequest(t, h.Uploads, `{"purpose":"avatar","fileName":"a.jpg","contentType":"image/jpeg","size":9}`)
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"formUrl"`) || !strings.Contains(w.Body.String(), `"formData"`) || !strings.Contains(w.Body.String(), `"file"`) {
				t.Fatalf("upload contract changed: %s", w.Body.String())
			}
			if repo.pending.StorageProvider != provider || repo.pending.StorageBucket != "test-bucket" || repo.creates != 1 {
				t.Fatal("task location not persisted")
			}
			if provider == "oss" && !strings.HasPrefix(repo.pending.ObjectKey, "oss-test/business/avatars/") {
				t.Fatal("OSS task missing prefix")
			}
			if provider == "minio" && !strings.HasPrefix(repo.pending.ObjectKey, "uploads/") {
				t.Fatal("legacy MinIO key changed")
			}
			w = fileStorageRequest(t, h.Complete, `{"fileId":"test-file"}`)
			if w.Code != 200 || repo.readyCalls != 1 || store.statCalls != 1 {
				t.Fatalf("completion failed: %s", w.Body.String())
			}
		})
	}
}

func TestFileCompletionUsesPinnedLegacyStorage(t *testing.T) {
	current := &fileStoreStub{provider: "oss", bucket: "test-bucket"}
	legacy := &fileStoreStub{provider: "minio", bucket: "legacy-bucket", info: infra.ObjectInfo{Size: 9}}
	repo := &fileRepoStub{pending: models.PendingFile{StorageProvider: "minio", StorageBucket: "legacy-bucket", ObjectKey: "uploads/old.jpg", Size: 9}}
	h := &FileHandler{Storage: &infra.Storage{Current: current, Legacy: legacy}, Files: repo}
	w := fileStorageRequest(t, h.Complete, `{"fileId":"test-file"}`)
	if w.Code != 200 || current.statCalls != 0 || legacy.statCalls != 1 || repo.readyCalls != 1 {
		t.Fatal("global provider switch redirected an existing task")
	}
}

func TestLegacyCompletionKeepsOldSizeDeclarationBehavior(t *testing.T) {
	store := &fileStoreStub{provider: "minio", bucket: "legacy-bucket", info: infra.ObjectInfo{Size: 8}}
	repo := &fileRepoStub{pending: models.PendingFile{StorageProvider: "minio", StorageBucket: "legacy-bucket", ObjectKey: "uploads/old.jpg", Size: 9}}
	h := &FileHandler{Storage: &infra.Storage{Current: store}, Files: repo}
	if w := fileStorageRequest(t, h.Complete, `{"fileId":"test-file"}`); w.Code != 200 || repo.readyCalls != 1 {
		t.Fatal("legacy client size declaration became a breaking check")
	}
}

func TestFileCompletionNeverMarksMissingOrInvalidObjectReady(t *testing.T) {
	for name, tc := range map[string]struct {
		size   int64
		err    error
		status int
	}{
		"empty": {0, nil, 400}, "mismatch": {8, nil, 400}, "oversize": {infra.MaxFormUploadBytes + 1, nil, 400},
		"missing": {0, infra.ErrObjectNotFound, 400}, "permission or timeout": {0, errors.New("unavailable"), 503},
	} {
		t.Run(name, func(t *testing.T) {
			store := &fileStoreStub{provider: "oss", bucket: "test-bucket", info: infra.ObjectInfo{Size: tc.size}, err: tc.err}
			repo := &fileRepoStub{pending: models.PendingFile{StorageProvider: "oss", StorageBucket: "test-bucket", ObjectKey: "oss-test/business/uploads/a.jpg", Size: 9}}
			h := &FileHandler{Storage: &infra.Storage{Current: store}, Files: repo}
			w := fileStorageRequest(t, h.Complete, `{"fileId":"test-file"}`)
			if w.Code != tc.status || repo.readyCalls != 0 {
				t.Fatalf("invalid upload accepted: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestOSSUploadRejectsInvalidSizeWithoutCreatingTask(t *testing.T) {
	store := &fileStoreStub{provider: "oss", bucket: "test-bucket"}
	repo := &fileRepoStub{}
	h := &FileHandler{Storage: &infra.Storage{Current: store}, Files: repo}
	w := fileStorageRequest(t, h.Uploads, `{"purpose":"avatar","fileName":"a.jpg","size":0}`)
	if w.Code != 400 || repo.creates != 0 {
		t.Fatal("invalid task was created")
	}
}

func TestLegacyDevUploadStillWorksWithoutStorage(t *testing.T) {
	repo := &fileRepoStub{}
	h := &FileHandler{Storage: &infra.Storage{Current: &infra.MinIO{}}, Files: repo}
	w := fileStorageRequest(t, h.Uploads, `{"purpose":"image","fileName":"a.jpg","size":9}`)
	if w.Code != 200 {
		t.Fatal("legacy local-dev behavior changed")
	}
	w = fileStorageRequest(t, h.Complete, `{"fileId":"test-file"}`)
	if w.Code != 200 || repo.readyCalls != 1 {
		t.Fatal("legacy local-dev completion changed")
	}
}
