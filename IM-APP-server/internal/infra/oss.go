package infra

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"im-app-server/internal/config"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
)

const (
	MaxFormUploadBytes           int64 = 20 << 20
	ossImageListProcess                = "image/resize,w_360/quality,q_60/format,webp"
	ossImagePreviewProcess             = "image/resize,w_1280/quality,q_75/format,webp"
	ossImagePreviewMobileProcess       = "image/resize,w_960/quality,q_72/format,webp"
	ossImageAvatarProcess              = "image/resize,w_128/quality,q_70/format,webp"
	// Must stay `public`: Aliyun CDN treats Cache-Control private/no-cache/no-store
	// as "do not cache" with a higher priority than any console cache rule, so a
	// private directive here would push every request back to origin and undo the
	// CDN cost saving. Objects are immutable because keys are random UUIDs and
	// uploads set x-oss-forbid-overwrite.
	ossObjectCacheControl = "public, max-age=31536000, immutable"
)

type OSS struct {
	cfg                config.OSSConfig
	client, signClient *oss.Client
	now                func() time.Time
}

// NewOSS only validates local configuration. It never changes shared cloud resources.
func NewOSS(cfg config.OSSConfig) (*OSS, error) {
	for field, value := range map[string]string{"OSS_REGION": cfg.Region, "OSS_BUCKET": cfg.Bucket,
		"OSS_ACCESS_KEY_ID": cfg.AccessKeyID, "OSS_ACCESS_KEY_SECRET": cfg.AccessKeySecret} {
		if strings.TrimSpace(value) == "" {
			return nil, storageConfigError(field)
		}
	}
	if strings.ContainsAny(cfg.Bucket, "/.:% \\?#\r\n") {
		return nil, storageConfigError("OSS_BUCKET")
	}
	if !strings.HasSuffix(cfg.KeyPrefix, "/") || !validStorageKey(strings.TrimSuffix(cfg.KeyPrefix, "/")) || strings.HasPrefix(cfg.KeyPrefix, "app-releases/") {
		return nil, storageConfigError("OSS_KEY_PREFIX (non-empty, trailing slash, separate from legacy keys)")
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = "https://oss-" + cfg.Region + ".aliyuncs.com"
	}
	if _, err := secureStorageURL(cfg.Endpoint, true); err != nil {
		return nil, storageConfigError("OSS_ENDPOINT")
	}
	if cfg.PublicUploadURL == "" {
		cfg.PublicUploadURL = "https://" + cfg.Bucket + ".oss-" + cfg.Region + ".aliyuncs.com"
	}
	if _, err := secureStorageURL(cfg.PublicUploadURL, true); err != nil {
		return nil, storageConfigError("OSS_PUBLIC_UPLOAD_URL")
	}
	if cfg.PublicBaseURL != "" {
		if _, err := secureStorageURL(cfg.PublicBaseURL, false); err != nil {
			return nil, storageConfigError("OSS_PUBLIC_BASE_URL")
		}
	} else {
		if _, err := secureStorageURL(cfg.MediaProxyURL, false); err != nil {
			return nil, storageConfigError("OSS_MEDIA_PROXY_URL")
		}
		if len(cfg.MediaSigningKey) < 32 {
			return nil, storageConfigError("OSS_MEDIA_SIGNING_KEY (at least 32 characters)")
		}
	}
	creds := credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.AccessKeySecret, cfg.SessionToken)
	clientConfig := oss.LoadDefaultConfig().WithRegion(cfg.Region).WithEndpoint(cfg.Endpoint).
		WithCredentialsProvider(creds).WithSignatureVersion(oss.SignatureVersionV4)
	// Public signing must use the exact host the client will contact, never a CDN
	// rewrite of a URL signed for an internal endpoint.
	signConfig := oss.LoadDefaultConfig().WithRegion(cfg.Region).WithEndpoint(cfg.PublicUploadURL).
		WithUseCName(true).WithCredentialsProvider(creds).WithSignatureVersion(oss.SignatureVersionV4).
		WithAdditionalHeaders([]string{"Cache-Control"})
	return &OSS{cfg: cfg, client: oss.NewClient(clientConfig), signClient: oss.NewClient(signConfig), now: time.Now}, nil
}

func secureStorageURL(raw string, rootOnly bool) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (rootOnly && u.Path != "" && u.Path != "/") {
		return nil, storageConfigError("HTTPS URL without credentials, query or fragment")
	}
	return u, nil
}

func (o *OSS) Available() bool  { return o != nil && o.client != nil && o.signClient != nil }
func (o *OSS) Provider() string { return "oss" }
func (o *OSS) BucketName() string {
	if o == nil {
		return ""
	}
	return o.cfg.Bucket
}
func (o *OSS) NewKey(logical string) (string, error) {
	if !o.Available() {
		return "", ErrStorageUnavailable
	}
	if !validStorageKey(logical) {
		return "", ErrObjectKeyScope
	}
	return o.cfg.KeyPrefix + logical, nil
}
func (o *OSS) accepts(key string) bool {
	return o.Available() && strings.HasPrefix(key, o.cfg.KeyPrefix) && len(key) > len(o.cfg.KeyPrefix) && validStorageKey(key)
}
func (o *OSS) releaseKey(key string) bool {
	return o.accepts(key) && strings.HasPrefix(key, o.cfg.KeyPrefix+"app-releases/")
}

func (o *OSS) FileURL(key string) string {
	if !o.accepts(key) {
		return ""
	}
	if o.cfg.PublicBaseURL != "" {
		return strings.TrimSuffix(o.cfg.PublicBaseURL, "/") + "/" + escapeObjectKey(key)
	}
	u, _ := url.Parse(o.cfg.MediaProxyURL)
	q := u.Query()
	q.Set("key", key)
	q.Set("token", o.mediaToken(key))
	u.RawQuery = q.Encode()
	return u.String()
}

func (o *OSS) mediaToken(key string) string {
	return base64.RawURLEncoding.EncodeToString(hmacSHA256([]byte(o.cfg.MediaSigningKey), o.cfg.Bucket+"\n"+key))
}

// ResolveMedia is a stable capability URL, preserving existing public-link
// semantics. It is not conversation-membership authorization. Variants are a
// closed server-side allowlist so clients cannot request arbitrary OSS work.
func (o *OSS) ResolveMedia(ctx context.Context, key, token, variant string) (string, error) {
	if !o.accepts(key) || o.cfg.MediaSigningKey == "" || !hmac.Equal([]byte(token), []byte(o.mediaToken(key))) {
		return "", ErrObjectKeyScope
	}
	process, err := ossImageProcess(key, variant)
	if err != nil {
		return "", err
	}
	return o.presignGet(ctx, key, process, 10*time.Minute)
}

func ossImageProcess(key, variant string) (string, error) {
	var process string
	switch variant {
	case "":
		return "", nil
	case "list":
		process = ossImageListProcess
	case "preview":
		process = ossImagePreviewProcess
	case "preview-mobile":
		process = ossImagePreviewMobileProcess
	case "avatar":
		process = ossImageAvatarProcess
	default:
		return "", ErrInvalidMediaVariant
	}
	if !isOSSImageKey(key) {
		return "", nil
	}
	return process, nil
}

func isOSSImageKey(key string) bool {
	switch strings.ToLower(path.Ext(key)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic", ".heif", ".avif":
		return true
	default:
		return false
	}
}

func validOSSExpiry(expiry time.Duration) bool { return expiry > 0 && expiry <= time.Hour }

// OSS v4 PostObject policy: the file field is sent last by both H5 and uni.uploadFile.
// Unlike PUT signing, the SDK does not expose a PostObject policy helper.
func (o *OSS) PresignPost(ctx context.Context, key, contentType string, expiry time.Duration) (string, map[string]string, error) {
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	if !o.accepts(key) {
		return "", nil, ErrObjectKeyScope
	}
	if !validOSSExpiry(expiry) {
		return "", nil, storageConfigError("upload expiry")
	}
	now := o.now().UTC()
	date := now.Format("20060102")
	fields := map[string]string{
		"key": key, "success_action_status": "204", "x-oss-forbid-overwrite": "true",
		"Cache-Control":           ossObjectCacheControl,
		"x-oss-signature-version": "OSS4-HMAC-SHA256",
		"x-oss-credential":        o.cfg.AccessKeyID + "/" + date + "/" + o.cfg.Region + "/oss/aliyun_v4_request",
		"x-oss-date":              now.Format("20060102T150405Z"),
	}
	if contentType != "" && contentType != "application/octet-stream" {
		fields["Content-Type"] = contentType
	}
	if o.cfg.SessionToken != "" {
		fields["x-oss-security-token"] = o.cfg.SessionToken
	}
	conditions := []any{map[string]string{"bucket": o.cfg.Bucket}, []any{"content-length-range", 1, MaxFormUploadBytes}}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		conditions = append(conditions, map[string]string{key: fields[key]})
	}
	policy, err := json.Marshal(struct {
		Expiration string `json:"expiration"`
		Conditions []any  `json:"conditions"`
	}{now.Add(expiry).Format("2006-01-02T15:04:05.000Z"), conditions})
	if err != nil {
		return "", nil, err
	}
	fields["policy"] = base64.StdEncoding.EncodeToString(policy)
	fields["x-oss-signature"] = ossPostSignature(o.cfg.AccessKeySecret, date, o.cfg.Region, fields["policy"])
	return strings.TrimSuffix(o.cfg.PublicUploadURL, "/"), fields, nil
}

func ossPostSignature(secret, date, region, policy string) string {
	signingKey := []byte("aliyun_v4" + secret)
	for _, value := range []string{date, region, "oss", "aliyun_v4_request"} {
		signingKey = hmacSHA256(signingKey, value)
	}
	return hex.EncodeToString(hmacSHA256(signingKey, policy))
}

func hmacSHA256(key []byte, value string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = io.WriteString(h, value)
	return h.Sum(nil)
}

func (o *OSS) PresignPutUpload(ctx context.Context, key, contentType string, expiry time.Duration) (string, map[string]string, error) {
	if !o.accepts(key) {
		return "", nil, ErrObjectKeyScope
	}
	if !validOSSExpiry(expiry) {
		return "", nil, storageConfigError("upload expiry")
	}
	request := &oss.PutObjectRequest{Bucket: oss.Ptr(o.cfg.Bucket), Key: oss.Ptr(key), ForbidOverwrite: oss.Ptr("true"),
		CacheControl: oss.Ptr(ossObjectCacheControl)}
	if contentType != "" {
		request.ContentType = oss.Ptr(contentType)
	}
	result, err := o.signClient.Presign(ctx, request, oss.PresignExpires(expiry))
	if err != nil {
		return "", nil, err
	}
	return result.URL, result.SignedHeaders, nil
}

func (o *OSS) PresignGet(ctx context.Context, key string, expiry time.Duration) (string, error) {
	return o.presignGet(ctx, key, "", expiry)
}

func (o *OSS) presignGet(ctx context.Context, key, process string, expiry time.Duration) (string, error) {
	if !o.accepts(key) {
		return "", ErrObjectKeyScope
	}
	if !validOSSExpiry(expiry) {
		return "", storageConfigError("download expiry")
	}
	request := &oss.GetObjectRequest{Bucket: oss.Ptr(o.cfg.Bucket), Key: oss.Ptr(key)}
	if process != "" {
		request.Process = oss.Ptr(process)
	}
	result, err := o.signClient.Presign(ctx, request, oss.PresignExpires(expiry))
	if err != nil {
		return "", err
	}
	return result.URL, nil
}

func (o *OSS) PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	if !o.accepts(key) {
		return ErrObjectKeyScope
	}
	if size <= 0 || size > MaxFormUploadBytes {
		return storageConfigError("object size")
	}
	_, err := o.client.PutObject(ctx, &oss.PutObjectRequest{Bucket: oss.Ptr(o.cfg.Bucket), Key: oss.Ptr(key), Body: body,
		ContentLength: oss.Ptr(size), ContentType: oss.Ptr(contentType), CacheControl: oss.Ptr(ossObjectCacheControl), ForbidOverwrite: oss.Ptr("true")})
	return err
}

func (o *OSS) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	if !o.accepts(key) {
		return ObjectInfo{}, ErrObjectKeyScope
	}
	info, err := o.client.HeadObject(ctx, &oss.HeadObjectRequest{Bucket: oss.Ptr(o.cfg.Bucket), Key: oss.Ptr(key)})
	if err != nil {
		var serviceErr *oss.ServiceError
		// HEAD has no response body; the SDK can report BadErrorResponse for a
		// plain 404. Do not confuse 403/5xx or a missing bucket with a missing key.
		if errors.As(err, &serviceErr) && serviceErr.StatusCode == 404 && (serviceErr.Code == "NoSuchKey" || serviceErr.Code == "" || serviceErr.Code == "NotFound" || serviceErr.Code == "BadErrorResponse") {
			return ObjectInfo{}, ErrObjectNotFound
		}
		return ObjectInfo{}, err
	}
	return ObjectInfo{Size: info.ContentLength}, nil
}

// putArchive is separate from client uploads so their 20 MiB contract stays fixed.
func (o *OSS) putArchive(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	archiveKey := strings.HasPrefix(key, o.cfg.KeyPrefix+"favorites/") || strings.HasPrefix(key, o.cfg.KeyPrefix+"forwards/")
	if !o.accepts(key) || !archiveKey || size <= 0 || size > MaxArchiveBytes {
		return ErrObjectKeyScope
	}
	_, err := o.client.PutObject(ctx, &oss.PutObjectRequest{Bucket: oss.Ptr(o.cfg.Bucket), Key: oss.Ptr(key), Body: body,
		ContentLength: oss.Ptr(size), ContentType: oss.Ptr(contentType), CacheControl: oss.Ptr(ossObjectCacheControl), ForbidOverwrite: oss.Ptr("true")})
	return err
}
