package infra

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

type archiveTransport func(*http.Request) (*http.Response, error)

func (f archiveTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type archiveStore struct {
	ObjectStorage
	objects         map[string][]byte
	puts            int
	putErr, statErr error
	emptyURL        bool
}

func (s *archiveStore) Available() bool                 { return true }
func (s *archiveStore) NewKey(k string) (string, error) { return "test/business/" + k, nil }
func (s *archiveStore) FileURL(k string) string {
	if s.emptyURL {
		return ""
	}
	return "https://business.example/" + k
}
func (s *archiveStore) Stat(_ context.Context, k string) (ObjectInfo, error) {
	if s.statErr != nil {
		return ObjectInfo{}, s.statErr
	}
	if data, ok := s.objects[k]; ok {
		return ObjectInfo{Size: int64(len(data))}, nil
	}
	return ObjectInfo{}, ErrObjectNotFound
}
func (s *archiveStore) PutObject(_ context.Context, k string, r io.Reader, _ int64, _ string) error {
	if s.putErr != nil {
		return s.putErr
	}
	s.puts++
	data, err := io.ReadAll(r)
	s.objects[k] = data
	return err
}

func newTestArchive() (*Archive, *archiveStore) {
	store := &archiveStore{objects: map[string][]byte{}}
	a := NewArchive(&Storage{Current: store}, []string{"https://chat.example/chat/"})
	a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"image/jpeg"}}, Body: io.NopCloser(strings.NewReader("image bytes")), ContentLength: 11, Request: r}, nil
	})
	return a, store
}

func TestArchiveIndependentCopyAndIdempotence(t *testing.T) {
	a, s := newTestArchive()
	content := `{"VideoElem":{"VideoUrl":"https://chat.example/chat/a","SnapshotUrl":"https://chat.example/chat/a"},"Duration":10}`
	first, err := a.Preserve(context.Background(), "user", "message", "video", content)
	if err != nil || strings.Contains(first, "chat.example") || !strings.Contains(first, "/favorites/user/") || s.puts != 1 {
		t.Fatalf("independent copy failed: %v, puts=%d", err, s.puts)
	}
	second, err := a.Preserve(context.Background(), "user", "message", "video", content)
	if err != nil || first != second || s.puts != 1 {
		t.Fatal("retry changed persisted object")
	}
	third, err := a.Preserve(context.Background(), "other", "message", "video", content)
	if err != nil || third == first || s.puts != 2 {
		t.Fatal("users share favorite ownership namespace")
	}
	for _, data := range s.objects {
		if string(data) != "image bytes" {
			t.Fatal("content not copied")
		}
	}
}

const (
	testSignedSourcePrefix = "https://oss-chat.example/im-app-production/chat/"
	testCDNTargetPrefix    = "https://chat-cdn.example/im-app-production/chat/"
	testCDNRule            = testSignedSourcePrefix + "->" + testCDNTargetPrefix
)

func TestArchiveCDNRewriteDropsExpiredSignature(t *testing.T) {
	store := &archiveStore{objects: map[string][]byte{}}
	a := NewArchive(&Storage{Current: store}, nil).WithCDNRewrites([]string{testCDNRule})

	signed := testSignedSourcePrefix + "managed-v1/a.jpg?OSSAccessKeyId=k&Expires=1&Signature=s"
	if got, want := a.cdnSource(signed), testCDNTargetPrefix+"managed-v1/a.jpg"; got != want {
		t.Fatalf("expired signed url not rewritten:\n got=%q\nwant=%q", got, want)
	}

	// 未命中规则的地址必须逐字节保持原样：换桶、换路径、缺对象名都不能部分改写。
	for _, raw := range []string{
		"https://other.example/im-app-production/chat/managed-v1/a.jpg?Signature=s",
		testSignedSourcePrefix[:len(testSignedSourcePrefix)-4] + "business/doc/a.jpg?Signature=s",
		testSignedSourcePrefix, // 只有前缀，没有对象名
		"/im-app-production/chat/managed-v1/a.jpg?Signature=s",
	} {
		if got := a.cdnSource(raw); got != raw {
			t.Fatalf("unexpected rewrite of %q -> %q", raw, got)
		}
	}

	// 规则格式错误同样只能保持原样，绝不能猜。
	bad := NewArchive(&Storage{Current: store}, nil).
		WithCDNRewrites([]string{"broken-rule", "->https://x/", "https://y/->"})
	if got := bad.cdnSource(signed); got != signed {
		t.Fatalf("malformed rule rewrote the url: %q", got)
	}

	// 未配置规则时行为与改动前完全一致。
	plain := NewArchive(&Storage{Current: store}, nil)
	if got := plain.cdnSource(signed); got != signed {
		t.Fatalf("rewrite applied without any rule: %q", got)
	}
}

func TestArchiveCDNRewriteStaysInsideAllowlist(t *testing.T) {
	store := &archiveStore{objects: map[string][]byte{}}
	signed := testSignedSourcePrefix + "managed-v1/a.jpg?OSSAccessKeyId=k&Expires=1&Signature=s"

	// 目标 CDN 前缀在白名单内：改写后仍可通过，旧地址因此能被归档。
	ok := NewArchive(&Storage{Current: store}, []string{testSignedSourcePrefix, testCDNTargetPrefix}).
		WithCDNRewrites([]string{testCDNRule})
	if !ok.allowed(ok.cdnSource(signed)) {
		t.Fatal("CDN target inside the allowlist must stay fetchable")
	}

	// 目标 CDN 前缀漏配：不允许悄悄放行到未知主机，必须拒绝而不是继续下载。
	missing := NewArchive(&Storage{Current: store}, []string{testSignedSourcePrefix}).
		WithCDNRewrites([]string{testCDNRule})
	if missing.allowed(missing.cdnSource(signed)) {
		t.Fatal("rewrote source into a host outside the allowlist")
	}
}

func TestForwardArchiveSeparateFromFavoritesAndSource(t *testing.T) {
	a, s := newTestArchive()
	content := `{"quoteMessage":{"ContentType":102,"PictureElem":{"SourcePicture":{"Url":"https://chat.example/chat/a"},"SnapshotPicture":{"Url":"https://chat.example/chat/b"}}},"text":"https://untrusted.example/keep-as-text"}`
	saved, err := a.PreserveForward(context.Background(), "user", "source", content)
	if err != nil || strings.Contains(saved, "chat.example") || !strings.Contains(saved, "/forwards/user/") || s.puts != 1 {
		t.Fatal("independent forward failed", err)
	}
	favorite, err := a.Preserve(context.Background(), "user", "source", "image", `{"url":"https://chat.example/chat/a"}`)
	if err != nil || strings.Contains(favorite, "/forwards/") || !strings.Contains(favorite, "/favorites/") || s.puts != 2 {
		t.Fatal("favorite and forward share lifetime", err)
	}
	if !strings.Contains(saved, "https://untrusted.example/keep-as-text") {
		t.Fatal("text URL rewritten")
	}
	a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("missing")), Request: r}, nil
	})
	if _, err = a.PreserveForward(context.Background(), "user", "missing", content); !errors.Is(err, ErrArchive) || s.puts != 2 {
		t.Fatal("missing source was marked protected")
	}
}

func TestArchiveFailsClosed(t *testing.T) {
	for _, test := range []string{"source404", "putDenied", "headDenied", "missingURL", "invalidOwner", "untrustedHost", "partialBody", "oversize", "emptyURL"} {
		t.Run(test, func(t *testing.T) {
			a, s := newTestArchive()
			uid, content := "user", "https://chat.example/chat/a"
			switch test {
			case "source404":
				a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("missing")), Request: r}, nil
				})
			case "putDenied":
				s.putErr = errors.New("denied")
			case "headDenied":
				s.statErr = errors.New("denied")
			case "emptyURL":
				s.emptyURL = true
			case "missingURL":
				content = `{"path":"file:///tmp/a"}`
			case "invalidOwner":
				uid = "../user"
			case "untrustedHost":
				content = "https://evil.example/chat/a"
			case "partialBody":
				a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: 200, ContentLength: 10, Body: io.NopCloser(strings.NewReader("a")), Request: r}, nil
				})
			case "oversize":
				a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
					return &http.Response{StatusCode: 200, ContentLength: MaxArchiveBytes + 1, Body: io.NopCloser(strings.NewReader("a")), Request: r}, nil
				})
			}
			if _, err := a.Preserve(context.Background(), uid, "message", "image", content); !errors.Is(err, ErrArchive) {
				t.Fatal("failed copy returned success")
			}
			if s.puts != 0 {
				t.Fatal("failed validation wrote object")
			}
		})
	}
}

func TestArchiveRejectsRedirectToUntrustedHost(t *testing.T) {
	a, s := newTestArchive()
	calls := 0
	a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://evil.example/secret"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	if _, err := a.Preserve(context.Background(), "user", "message", "file", "https://chat.example/chat/a"); !errors.Is(err, ErrArchive) || calls != 1 || s.puts != 0 {
		t.Fatal("untrusted redirect followed")
	}
}

func TestArchiveSourceScopeAndPublicAddresses(t *testing.T) {
	a, _ := newTestArchive()
	a.Prefixes = append(a.Prefixes, "http://legacy.example/object/")
	for _, raw := range []string{"https://chat.example/chat/a?q=signature", "http://legacy.example/object/a"} {
		if !a.allowed(raw) {
			t.Fatal("configured path rejected")
		}
	}
	for _, raw := range []string{"http://chat.example/chat/a", "https://evil.example/chat/a", "https://chat.example/chat-evil/a", "https://u:p@chat.example/chat/a", "https://chat.example/chat/../secret", "https://chat.example/chat/%2e%2e/secret", "https://chat.example/chat/%252e%252e/secret", "https://chat.example/chat/a#fragment"} {
		if a.allowed(raw) {
			t.Fatal("unsafe source allowed")
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "172.22.1.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:100.100.100.200", "64:ff9b::a00:1", "198.18.0.1"} {
		if archivePublicIP(net.ParseIP(ip)) {
			t.Fatalf("non-public IP accepted: %s", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !archivePublicIP(net.ParseIP(ip)) {
			t.Fatal("public IP rejected")
		}
	}
	if _, err := publicDial(context.Background(), "tcp", "127.0.0.1:443"); !errors.Is(err, ErrArchive) {
		t.Fatal("production dialer permits loopback")
	}
}

func TestArchiveDefaultsIncludeScopedBusinessURLs(t *testing.T) {
	o := testOSS(t)
	a := NewArchive(&Storage{Current: o, OSS: o}, nil)
	if !a.allowed(o.cfg.PublicUploadURL+"/"+o.cfg.KeyPrefix+"a") || !a.allowed(o.cfg.MediaProxyURL+"?key=a&token=x") {
		t.Fatal("validated storage URLs not usable as sources")
	}
	if a.allowed(o.cfg.PublicUploadURL + "/unrelated/a") {
		t.Fatal("bucket-wide permission introduced")
	}
	prefixes := SourcePrefixes(nil, "http://legacy.example/openim-api", "", "", "", "", "")
	if len(prefixes) != 1 || prefixes[0] != "http://legacy.example/object/" {
		t.Fatal("legacy resolver prefix missing")
	}
}

func TestArchiveCopyTotalByteBudget(t *testing.T) {
	a, s := newTestArchive()
	if _, _, err := a.copy(context.Background(), "favorites", "user", "message", "https://chat.example/chat/a", 10); !errors.Is(err, ErrArchive) || s.puts != 0 {
		t.Fatal("aggregate byte budget not enforced")
	}
}

func TestArchiveScopedResolverRedirectKeepsSourceSignature(t *testing.T) {
	for _, configured := range []bool{false, true} {
		a, s := newTestArchive()
		a.Prefixes = []string{"https://www.example/object/"}
		if configured {
			a.Prefixes = append(a.Prefixes, "https://chat.example/chat/")
		}
		calls := 0
		a.client.Transport = archiveTransport(func(r *http.Request) (*http.Response, error) {
			calls++
			if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
				t.Fatal("credentials attached to media GET")
			}
			if calls == 1 {
				if r.URL.RawQuery != "token=original%2Bcapability" {
					t.Fatal("resolver capability changed")
				}
				return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://chat.example/chat/a?x-oss-signature=source%2Bsignature"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
			}
			if r.URL.RawQuery != "x-oss-signature=source%2Bsignature" {
				t.Fatal("OSS signature changed")
			}
			return &http.Response{StatusCode: 200, Header: http.Header{}, ContentLength: 1, Body: io.NopCloser(strings.NewReader("a")), Request: r}, nil
		})
		out, err := a.Preserve(context.Background(), "user", "message", "image", "https://www.example/object/a?token=original%2Bcapability")
		if configured {
			if err != nil || calls != 2 || s.puts != 1 || !strings.Contains(out, "/favorites/") || strings.Contains(out, "x-oss-signature") {
				t.Fatal("trusted redirect not archived into stable link")
			}
		} else if !errors.Is(err, ErrArchive) || calls != 1 || s.puts != 0 {
			t.Fatal("unconfigured redirect followed")
		}
	}
}

func TestValidateArchiveSourceConfiguration(t *testing.T) {
	if err := ValidateArchiveSources([]string{"https://chat.example/app/chat/", "https://www.example/api/v1/public/oss-media", "http://legacy.example/minio/bucket/"}); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"https://chat.example/", "https://chat.example", "file:///files/", "https://user:password@chat.example/chat/", "https://chat.example/chat/?token=secret", "https://chat.example/chat/#part", "https://chat.example/chat/../", "https://chat.example/chat/%252e/", "http://127.0.0.1/object/", "http://100.100.100.200/object/", "http://[::1]/object/"} {
		err := ValidateArchiveSources([]string{raw})
		if err == nil {
			t.Fatal("unscoped or non-public archive source accepted")
		}
		if strings.Contains(err.Error(), raw) || strings.Contains(err.Error(), "password") || strings.Contains(err.Error(), "secret") {
			t.Fatal("source configuration leaked in error")
		}
	}
}
