package infra

import (
	"context"
	"fmt"
	"net/url"
	"path"
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

	signClient       *minio.Client
	publicPathPrefix string
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
	if cfg.PublicURL != "" {
		m.signClient, m.publicPathPrefix, err = newPublicSignClient(cfg.PublicURL, cfg.AccessKey, cfg.SecretKey)
		if err != nil {
			return nil, err
		}
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
			return nil, fmt.Errorf("minio set public-read bucket policy: %w", err)
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
	publicPathPrefix := ""
	if m.signClient != nil {
		signClient = m.signClient
		publicPathPrefix = m.publicPathPrefix
	} else if m.PublicURL != "" {
		var err error
		signClient, publicPathPrefix, err = newPublicSignClient(m.PublicURL, m.AccessKey, m.SecretKey)
		if err != nil {
			return PresignResult{}, err
		}
	}
	u, err := signClient.PresignedPutObject(ctx, m.Bucket, objectKey, expiry)
	if err != nil {
		return PresignResult{}, err
	}
	// 公网 URL 带代理前缀时，签名仍针对 MinIO 原始路径 /bucket/object；
	// 返回客户端前添加 /minio，Nginx 转发时再剥离此前缀。
	if publicPathPrefix != "" {
		u.Path = path.Join(publicPathPrefix, u.Path)
		u.RawPath = ""
	}

	var fileURL string
	escapedObjectKey := escapeObjectKey(objectKey)
	if m.PublicURL != "" {
		fileURL = fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(m.PublicURL, "/"), m.Bucket, escapedObjectKey)
	} else {
		scheme := "http"
		if m.UseSSL {
			scheme = "https"
		}
		fileURL = fmt.Sprintf("%s://%s/%s/%s", scheme, m.Endpoint, m.Bucket, escapedObjectKey)
	}
	return PresignResult{
		UploadURL: u.String(),
		FileURL:   fileURL,
		ObjectKey: objectKey,
		ExpiresIn: int(expiry.Seconds()),
	}, nil
}

func newPublicSignClient(publicURL, accessKey, secretKey string) (*minio.Client, string, error) {
	endpoint, err := url.Parse(publicURL)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return nil, "", fmt.Errorf("invalid MINIO_PUBLIC_URL %q", publicURL)
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, "", fmt.Errorf("MINIO_PUBLIC_URL must not contain user info, query, or fragment")
	}
	client, err := minio.New(endpoint.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: endpoint.Scheme == "https",
		Region: "us-east-1",
	})
	if err != nil {
		return nil, "", fmt.Errorf("minio public signing client: %w", err)
	}
	return client, strings.TrimSuffix(endpoint.Path, "/"), nil
}

func escapeObjectKey(objectKey string) string {
	parts := strings.Split(objectKey, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}
