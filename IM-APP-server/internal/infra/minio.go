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

// FileURL 返回对象上传完成后的可访问地址。
func (m *MinIO) FileURL(objectKey string) string {
	escapedObjectKey := escapeObjectKey(objectKey)
	if m.PublicURL != "" {
		return fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(m.PublicURL, "/"), m.Bucket, escapedObjectKey)
	}
	scheme := "http"
	if m.UseSSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, m.Endpoint, m.Bucket, escapedObjectKey)
}

// ObjectExists 检查对象是否真实存在于 MinIO。
// 用于上传完成确认：Android PUT 空包问题下 MinIO 可能返回 200 但对象为空/不存在，
// 直接 MarkReady 会把死链 URL 标记为可用，导致头像等资源 404 后显示灰色。
type ObjectInfo struct {
	Size int64
}

func (m *MinIO) ObjectExists(ctx context.Context, objectKey string) bool {
	_, ok := m.ObjectStat(ctx, objectKey)
	return ok
}

// ObjectStat 返回对象大小；对象不存在或 MinIO 未配置时 ok=false。
func (m *MinIO) ObjectStat(ctx context.Context, objectKey string) (ObjectInfo, bool) {
	if !m.Available() {
		return ObjectInfo{}, false
	}
	info, err := m.Client.StatObject(ctx, m.Bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, false
	}
	return ObjectInfo{Size: info.Size}, true
}

// PresignGet 生成限时下载地址，避免依赖桶公开读。
func (m *MinIO) PresignGet(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	if !m.Available() {
		return "", fmt.Errorf("minio not configured")
	}
	signClient, _, err := m.signClientForPublic()
	if err != nil {
		return "", err
	}
	u, err := signClient.PresignedGetObject(ctx, m.Bucket, objectKey, expiry, nil)
	if err != nil {
		return "", err
	}
	return m.rewritePublicPath(u.String()), nil
}
func (m *MinIO) PresignPut(ctx context.Context, objectKey, contentType string, expiry time.Duration) (string, error) {
	if !m.Available() {
		return "", fmt.Errorf("minio not configured")
	}
	signClient, _, err := m.signClientForPublic()
	if err != nil {
		return "", err
	}
	u, err := signClient.PresignedPutObject(ctx, m.Bucket, objectKey, expiry)
	if err != nil {
		return "", err
	}
	_ = contentType
	return m.rewritePublicPath(u.String()), nil
}

func (m *MinIO) rewritePublicPath(raw string) string {
	prefix := strings.TrimSuffix(m.publicPathPrefix, "/")
	if prefix == "" {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Path == "" || strings.HasPrefix(u.Path, prefix+"/") {
		return raw
	}
	u.Path = prefix + u.Path
	return u.String()
}

func (m *MinIO) signClientForPublic() (*minio.Client, string, error) {
	if m.signClient != nil {
		return m.signClient, m.publicPathPrefix, nil
	}
	if m.PublicURL != "" {
		return newPublicSignClient(m.PublicURL, m.AccessKey, m.SecretKey)
	}
	return m.Client, "", nil
}

// PresignPost 生成 H5/App 通用的预签名 multipart POST 表单。
func (m *MinIO) PresignPost(ctx context.Context, objectKey, contentType string, expiry time.Duration) (string, map[string]string, error) {
	if !m.Available() {
		return "", nil, fmt.Errorf("minio not configured")
	}
	signClient, _, err := m.signClientForPublic()
	if err != nil {
		return "", nil, err
	}
	policy := minio.NewPostPolicy()
	if err := policy.SetBucket(m.Bucket); err != nil {
		return "", nil, err
	}
	if err := policy.SetKey(objectKey); err != nil {
		return "", nil, err
	}
	if err := policy.SetExpires(time.Now().UTC().Add(expiry)); err != nil {
		return "", nil, err
	}
	if contentType != "" && contentType != "application/octet-stream" {
		if err := policy.SetContentType(contentType); err != nil {
			return "", nil, err
		}
	}
	if err := policy.SetContentLengthRange(1, 20<<20); err != nil {
		return "", nil, err
	}
	_, formData, err := signClient.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return "", nil, err
	}
	var postURL string
	if m.PublicURL != "" {
		postURL = fmt.Sprintf("%s/%s", strings.TrimSuffix(m.PublicURL, "/"), m.Bucket)
	} else {
		scheme := "http"
		if m.UseSSL {
			scheme = "https"
		}
		postURL = fmt.Sprintf("%s://%s/%s", scheme, m.Endpoint, m.Bucket)
	}
	return postURL, formData, nil
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
