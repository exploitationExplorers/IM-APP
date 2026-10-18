package infra

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"im-app-server/internal/config"
)

var (
	ErrObjectNotFound     = errors.New("storage object not found")
	ErrStorageUnavailable = errors.New("storage unavailable")
	ErrObjectKeyScope     = errors.New("object key outside configured scope")
)

// ObjectStorage preserves the existing POST/PUT upload contract on both clients.
// No delete or bucket-management capability is exposed to business handlers.
type ObjectStorage interface {
	Available() bool
	Provider() string
	BucketName() string
	NewKey(string) (string, error)
	FileURL(string) string
	PresignPost(context.Context, string, string, time.Duration) (string, map[string]string, error)
	PresignPutUpload(context.Context, string, string, time.Duration) (string, map[string]string, error)
	PresignGet(context.Context, string, time.Duration) (string, error)
	PutObject(context.Context, string, io.Reader, int64, string) error
	Stat(context.Context, string) (ObjectInfo, error)
}

type Storage struct {
	Current ObjectStorage
	Legacy  ObjectStorage
	OSS     *OSS
}

func NewStorage(cfg config.Config) (*Storage, error) {
	s := &Storage{}
	provider := cfg.StorageBackend()
	if provider != "minio" && provider != "oss" {
		return nil, ErrStorageUnavailable
	}
	// Constructing OSS clients is offline: never create buckets, set ACLs or probe keys.
	if provider == "oss" || cfg.OSS.Bucket != "" {
		var err error
		s.OSS, err = NewOSS(cfg.OSS)
		if err != nil {
			return nil, err
		}
	}
	if provider == "oss" {
		s.Current = s.OSS
		// Legacy pending tasks may still need HEAD. Do not run bucket management
		// against a legacy/production MinIO when enabling OSS.
		legacy, err := newMinIO(cfg.MinIO, false)
		if err != nil {
			return nil, err
		}
		s.Legacy = legacy
	} else {
		legacy, err := NewMinIO(cfg.MinIO)
		if err != nil {
			return nil, err
		}
		s.Current, s.Legacy = legacy, legacy
	}
	return s, nil
}

func (s *Storage) Available() bool { return s != nil && s.Current != nil && s.Current.Available() }

// ForLocation never lets a global provider switch redirect an existing task.
func (s *Storage) ForLocation(provider, bucket string) (ObjectStorage, error) {
	if s == nil {
		return nil, ErrStorageUnavailable
	}
	if provider == "" {
		provider = "minio"
	} // pre-OSS records
	for _, candidate := range []ObjectStorage{s.Current, s.Legacy, s.OSS} {
		if candidate != nil && candidate.Available() && candidate.Provider() == provider &&
			(bucket == "" || candidate.BucketName() == bucket) {
			return candidate, nil
		}
	}
	return nil, ErrStorageUnavailable
}

// Release uploads predate persisted upload tasks. Their distinct physical key
// namespace keeps older clients working without guessing from a signed URL.
func (s *Storage) ForReleaseKey(key string) (ObjectStorage, error) {
	if s == nil {
		return nil, ErrStorageUnavailable
	}
	if s.OSS != nil && s.OSS.releaseKey(key) {
		return s.ForLocation("oss", s.OSS.BucketName())
	}
	if validStorageKey(key) && strings.HasPrefix(key, "app-releases/") {
		return s.ForLocation("minio", "")
	}
	return nil, ErrObjectKeyScope
}

func validStorageKey(key string) bool {
	if key == "" || strings.HasPrefix(key, "/") || strings.ContainsAny(key, "\\%\x00\r\n?#") {
		return false
	}
	for _, part := range strings.Split(key, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func (m *MinIO) Provider() string { return "minio" }
func (m *MinIO) PresignPutUpload(ctx context.Context, key, contentType string, expiry time.Duration) (string, map[string]string, error) {
	u, err := m.PresignPut(ctx, key, contentType, expiry)
	return u, nil, err
}
func (m *MinIO) BucketName() string {
	if m == nil {
		return ""
	}
	return m.Bucket
}
func (m *MinIO) NewKey(key string) (string, error) {
	if !validStorageKey(key) {
		return "", ErrObjectKeyScope
	}
	return key, nil
}
func (m *MinIO) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	if !m.Available() {
		return ObjectInfo{}, ErrStorageUnavailable
	}
	info, err := m.Client.StatObject(ctx, m.Bucket, key, minioStatOptions())
	if err != nil {
		return ObjectInfo{}, classifyMinIOError(err)
	}
	return ObjectInfo{Size: info.Size}, nil
}

func storageConfigError(field string) error {
	return fmt.Errorf("invalid or missing %s for OSS storage", field)
}
