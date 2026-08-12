package infra

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"im-app-server/internal/config"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIO wraps optional MinIO client for presigned uploads.
type MinIO struct {
	Client    *minio.Client
	Bucket    string
	Endpoint  string
	PublicURL string // 对外可访问地址（如 http://8.210.72.157:9000）
	UseSSL    bool
	AccessKey string
	SecretKey string
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
		Client:    client,
		Bucket:    cfg.Bucket,
		Endpoint:  cfg.Endpoint,
		PublicURL: cfg.PublicURL,
		UseSSL:    cfg.UseSSL,
		AccessKey: cfg.AccessKey,
		SecretKey: cfg.SecretKey,
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
	// 配置开启时把桶设为公开读，外网可直接访问文件 URL（头像/图片等）
	if cfg.PublicRead {
		policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, cfg.Bucket)
		if err := client.SetBucketPolicy(ctx, cfg.Bucket, policy); err != nil {
			// 设置失败不致命，记录即可
			_ = err
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

// PresignPut 生成预签名上传地址。
// 若配置了 PublicURL，则用公网 host 生成预签名（host 与签名一致，外网可直接 PUT）；
// 生成预签名是纯本地计算，不发起网络请求，无需能连通公网 MinIO。
func (m *MinIO) PresignPut(ctx context.Context, objectKey, contentType string, expiry time.Duration) (PresignResult, error) {
	if !m.Available() {
		return PresignResult{}, fmt.Errorf("minio not configured")
	}
	signClient := m.Client
	if m.PublicURL != "" {
		host := strings.TrimPrefix(strings.TrimPrefix(m.PublicURL, "http://"), "https://")
		if c, err := minio.New(host, &minio.Options{
			Creds:  credentials.NewStaticV4(m.AccessKey, m.SecretKey, ""),
			Secure: m.UseSSL,
		}); err == nil {
			signClient = c
		}
	}
	u, err := signClient.PresignedPutObject(ctx, m.Bucket, objectKey, expiry)
	if err != nil {
		return PresignResult{}, err
	}

	var fileURL string
	if m.PublicURL != "" {
		fileURL = fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(m.PublicURL, "/"), m.Bucket, url.PathEscape(objectKey))
	} else {
		scheme := "http"
		if m.UseSSL {
			scheme = "https"
		}
		fileURL = fmt.Sprintf("%s://%s/%s/%s", scheme, m.Endpoint, m.Bucket, url.PathEscape(objectKey))
	}
	return PresignResult{
		UploadURL: u.String(),
		FileURL:   fileURL,
		ObjectKey: objectKey,
		ExpiresIn: int(expiry.Seconds()),
	}, nil
}
