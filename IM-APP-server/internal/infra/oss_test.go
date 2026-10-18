package infra

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"im-app-server/internal/config"
)

func testOSSConfig() config.OSSConfig {
	return config.OSSConfig{Region: "cn-hangzhou", Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "test-business",
		AccessKeyID: "test-id", AccessKeySecret: "test-secret", KeyPrefix: "oss-test/business/",
		MediaProxyURL: "https://test.example/api/v1/public/oss-media", MediaSigningKey: strings.Repeat("test", 10)}
}

func testOSS(t *testing.T) *OSS {
	t.Helper()
	o, err := NewOSS(testOSSConfig())
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func TestOSSPolicyContract(t *testing.T) {
	o := testOSS(t)
	o.now = func() time.Time { return time.Date(2026, 10, 17, 2, 0, 0, 0, time.UTC) }
	key, _ := o.NewKey("uploads/user/图片.jpg")
	u, fields, err := o.PresignPost(context.Background(), key, "image/jpeg", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if u != "https://test-business.oss-cn-hangzhou.aliyuncs.com" || fields["key"] != key || fields["success_action_status"] != "204" || fields["x-oss-forbid-overwrite"] != "true" {
		t.Fatalf("invalid POST contract")
	}
	if fields["x-oss-credential"] != "test-id/20261017/cn-hangzhou/oss/aliyun_v4_request" || fields["x-oss-date"] != "20261017T020000Z" || fields["Content-Type"] != "image/jpeg" {
		t.Fatal("invalid v4 fields")
	}
	raw, err := base64.StdEncoding.DecodeString(fields["policy"])
	if err != nil {
		t.Fatal(err)
	}
	var policy struct {
		Expiration string
		Conditions []json.RawMessage
	}
	if err := json.Unmarshal(raw, &policy); err != nil {
		t.Fatal(err)
	}
	if policy.Expiration != "2026-10-17T02:15:00.000Z" {
		t.Fatal("incorrect expiry")
	}
	if !strings.Contains(string(raw), `["content-length-range",1,20971520]`) || !strings.Contains(string(raw), `"bucket":"test-business"`) {
		t.Fatal("missing policy bounds")
	}
	if fields["x-oss-signature"] != ossPostSignature("test-secret", "20261017", "cn-hangzhou", fields["policy"]) {
		t.Fatal("signature not bound to policy")
	}
	if strings.Contains(string(raw), "test-secret") {
		t.Fatal("secret leaked in policy")
	}
}

func TestOSSV4PostSignatureVector(t *testing.T) {
	// Fixed vector independently calculated using Python's hmac/hashlib.
	got := ossPostSignature("test-secret", "20261017", "cn-hangzhou", "eyJleHBpcmF0aW9uIjoiMjAyNi0xMC0xN1QwMzowMDowMC4wMDBaIn0=")
	if got != "66cddea527186926a312ab1a1ed98f255e4626e2e0124bf206b77a2d628a4d57" {
		t.Fatal("incorrect OSS v4 signing key derivation")
	}
}

func TestOSSPresignedPutKeepsPublicHostAndRequiredHeaders(t *testing.T) {
	o := testOSS(t)
	key, _ := o.NewKey("app-releases/android/a b.wgt")
	raw, headers, err := o.PresignPutUpload(context.Background(), key, "application/zip", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if u.Scheme != "https" || u.Host != "test-business.oss-cn-hangzhou.aliyuncs.com" || u.Path != "/"+key || !strings.Contains(u.EscapedPath(), "%20") {
		t.Fatalf("incorrect signed URL host/key: %s", raw)
	}
	if u.Query().Get("x-oss-signature-version") != "OSS4-HMAC-SHA256" || u.Query().Get("x-oss-signature") == "" {
		t.Fatal("missing v4 signature")
	}
	found, contentTypeFound := false, false
	for k, v := range headers {
		if strings.EqualFold(k, "x-oss-forbid-overwrite") && v == "true" {
			found = true
		}
		if strings.EqualFold(k, "Content-Type") && v == "application/zip" {
			contentTypeFound = true
		}
	}
	if !found {
		t.Fatal("PUT must return its signed overwrite-protection header")
	}
	if !contentTypeFound {
		t.Fatal("PUT must preserve the declared package Content-Type in signed headers")
	}
}

func TestOSSPrivateMediaStableAndScoped(t *testing.T) {
	o := testOSS(t)
	key, _ := o.NewKey("voices/u/a.m4a")
	stable := o.FileURL(key)
	if stable == "" || stable != o.FileURL(key) || strings.Contains(stable, "x-oss-signature=") {
		t.Fatal("stored URLs must be stable")
	}
	u, _ := url.Parse(stable)
	signed, err := o.ResolveMedia(context.Background(), key, u.Query().Get("token"))
	if err != nil || !strings.Contains(signed, "x-oss-signature=") {
		t.Fatalf("private resolution failed: %v", err)
	}
	for _, invalid := range []string{"uploads/production.jpg", key + "x", "oss-test/business/../production.jpg"} {
		if _, err := o.ResolveMedia(context.Background(), invalid, u.Query().Get("token")); !errors.Is(err, ErrObjectKeyScope) {
			t.Fatal("token/key scope bypass")
		}
	}
	if _, err := o.ResolveMedia(context.Background(), key, "invalid"); !errors.Is(err, ErrObjectKeyScope) {
		t.Fatal("invalid token accepted")
	}
}

func TestOSSRejectsOutOfScopeBeforeAnyNetwork(t *testing.T) {
	o := testOSS(t)
	for _, key := range []string{"", "uploads/production.jpg", "/oss-test/business/a", "oss-test/business/../a", "oss-test/business//a", "oss-test/business/%2e%2e/a", "oss-test/business/a?x"} {
		if _, _, err := o.PresignPost(context.Background(), key, "", time.Minute); !errors.Is(err, ErrObjectKeyScope) {
			t.Fatalf("POST scope bypass: %s", key)
		}
		if _, _, err := o.PresignPutUpload(context.Background(), key, "", time.Minute); !errors.Is(err, ErrObjectKeyScope) {
			t.Fatal("PUT scope bypass")
		}
		if _, err := o.PresignGet(context.Background(), key, time.Minute); !errors.Is(err, ErrObjectKeyScope) {
			t.Fatal("GET scope bypass")
		}
		if _, err := o.Stat(context.Background(), key); !errors.Is(err, ErrObjectKeyScope) {
			t.Fatal("HEAD scope bypass")
		}
		if err := o.PutObject(context.Background(), key, strings.NewReader("x"), 1, "text/plain"); !errors.Is(err, ErrObjectKeyScope) {
			t.Fatal("server PUT scope bypass")
		}
		if o.FileURL(key) != "" {
			t.Fatal("out of scope URL produced")
		}
	}
}

func TestOSSConfigFailsClosed(t *testing.T) {
	for name, change := range map[string]func(*config.OSSConfig){
		"missing secret":           func(c *config.OSSConfig) { c.AccessKeySecret = "" },
		"empty prefix":             func(c *config.OSSConfig) { c.KeyPrefix = "" },
		"unsafe prefix":            func(c *config.OSSConfig) { c.KeyPrefix = "../" },
		"legacy release collision": func(c *config.OSSConfig) { c.KeyPrefix = "app-releases/" },
		"http uploads":             func(c *config.OSSConfig) { c.PublicUploadURL = "http://example.test" },
		"path upload rewrite":      func(c *config.OSSConfig) { c.PublicUploadURL = "https://example.test/storage" },
		"no stable read":           func(c *config.OSSConfig) { c.MediaProxyURL = "" },
		"weak media key":           func(c *config.OSSConfig) { c.MediaSigningKey = "short" },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := testOSSConfig()
			change(&cfg)
			if _, err := NewOSS(cfg); err == nil {
				t.Fatal("unsafe config accepted")
			}
		})
	}
}

type storageRoundTripper func(*http.Request) (*http.Response, error)

func (f storageRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOSSHeadErrorsDistinguishMissingAndUnavailable(t *testing.T) {
	for _, status := range []int{200, 403, 404, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			o := testOSS(t)
			o.client = oss.NewClient(oss.LoadDefaultConfig().WithRegion("cn-hangzhou").WithRetryMaxAttempts(1).
				WithCredentialsProvider(credentials.NewStaticCredentialsProvider("fake", "fake")).
				WithHttpClient(&http.Client{Transport: storageRoundTripper(func(r *http.Request) (*http.Response, error) {
					if r.Method != "HEAD" || !strings.Contains(r.URL.Path, "oss-test/business/") {
						t.Fatal("unexpected storage operation")
					}
					return &http.Response{StatusCode: status, Header: http.Header{"Content-Length": {"9"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
				})}))
			info, err := o.Stat(context.Background(), "oss-test/business/uploads/a.jpg")
			if status == 200 {
				if err != nil || info.Size != 9 {
					t.Fatalf("HEAD metadata: %v %+v", err, info)
				}
			} else if status == 404 {
				if !errors.Is(err, ErrObjectNotFound) {
					t.Fatalf("404 classification: %v", err)
				}
			} else if err == nil || errors.Is(err, ErrObjectNotFound) {
				t.Fatal("authorization/outage must not look like missing content")
			}
		})
	}
}

func TestStorageDefaultsAndLegacyTaskRouting(t *testing.T) {
	if _, err := NewStorage(config.Config{}); err == nil {
		t.Fatal("missing default OSS configuration must not fall back to MinIO")
	}
	defaultStore, err := NewStorage(config.Config{OSS: testOSSConfig()})
	if err != nil || !defaultStore.Available() || defaultStore.Current.Provider() != "oss" {
		t.Fatal("OSS was not selected by default")
	}
	legacyStore, err := NewStorage(config.Config{StorageProvider: "minio"})
	if err != nil || legacyStore.Current.Provider() != "minio" || legacyStore.Available() {
		t.Fatal("explicit MinIO local development mode changed")
	}
	cfg := config.Config{StorageProvider: "oss", OSS: testOSSConfig(), MinIO: config.MinIOConfig{Endpoint: "127.0.0.1:1", Bucket: "old-bucket", AccessKey: "fake", SecretKey: "fake"}}
	// An unreachable legacy endpoint is deliberate: enabling OSS must not touch it.
	s, err := NewStorage(cfg)
	if err != nil {
		t.Fatal(err)
	}
	old, err := s.ForLocation("minio", "old-bucket")
	if err != nil || old.Provider() != "minio" {
		t.Fatal("pending task moved to active OSS")
	}
	if _, err := s.ForLocation("oss", "another-bucket"); err == nil {
		t.Fatal("bucket mismatch accepted")
	}
	if _, err := s.ForReleaseKey("app-releases/android/old.wgt"); err != nil {
		t.Fatal("legacy release unavailable")
	}
	if _, err := s.ForReleaseKey("oss-test/business/app-releases/android/new.wgt"); err != nil {
		t.Fatal("OSS release unavailable")
	}
}
