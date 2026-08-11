package infra

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"im-app-server/internal/config"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIO wraps optional MinIO client for presigned uploads.
type MinIO struct {
	Client   *minio.Client
	Bucket   string
	Endpoint string
	UseSSL   bool
}

func NewMinIO(cfg config.MinIOConfig) (*MinIO, error) {
	if cfg.Endpoint == "" {
		return &MinIO{}, nil
	}
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio client: %w", err)
	}
	m := &MinIO{
		Client:   client,
		Bucket:   cfg.Bucket,
		Endpoint: cfg.Endpoint,
		UseSSL:   cfg.UseSSL,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exists, err := client.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("minio bucket check: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("minio make bucket: %w", err)
		}
	}
	return m, nil
}

func (m *MinIO) Available() bool {
	return m != nil && m.Client != nil
}

type PresignResult struct {
	UploadURL string `json:"uploadUrl"`
	FileURL   string `json:"fileUrl"`
	ObjectKey string `json:"objectKey"`
	ExpiresIn int    `json:"expiresIn"`
}

func (m *MinIO) PresignPut(ctx context.Context, objectKey, contentType string, expiry time.Duration) (PresignResult, error) {
	if !m.Available() {
		return PresignResult{}, fmt.Errorf("minio not configured")
	}
	u, err := m.Client.PresignedPutObject(ctx, m.Bucket, objectKey, expiry)
	if err != nil {
		return PresignResult{}, err
	}
	scheme := "http"
	if m.UseSSL {
		scheme = "https"
	}
	fileURL := fmt.Sprintf("%s://%s/%s/%s", scheme, m.Endpoint, m.Bucket, url.PathEscape(objectKey))
	return PresignResult{
		UploadURL: u.String(),
		FileURL:   fileURL,
		ObjectKey: objectKey,
		ExpiresIn: int(expiry.Seconds()),
	}, nil
}
