package scopedoss

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/openimsdk/tools/s3"
)

type spy struct {
	s3.Interface
	keys []string
}

func (d *spy) Engine() string        { return "ali-oss" }
func (d *spy) IsNotFound(error) bool { return true }
func (d *spy) InitiateMultipartUpload(_ context.Context, k string, _ *s3.PutOption) (*s3.InitiateMultipartUploadResult, error) {
	d.keys = append(d.keys, k)
	return &s3.InitiateMultipartUploadResult{Key: k, UploadID: "id"}, nil
}
func (d *spy) CompleteMultipartUpload(_ context.Context, _, k string, _ []s3.Part) (*s3.CompleteMultipartUploadResult, error) {
	d.keys = append(d.keys, k)
	return &s3.CompleteMultipartUploadResult{Key: k, Location: "https://signed.example/exact%20key?sig=a%2Bb"}, nil
}
func (d *spy) AuthSign(_ context.Context, _, k string, _ time.Duration, _ []int) (*s3.AuthSignResult, error) {
	d.keys = append(d.keys, k)
	return &s3.AuthSignResult{URL: "https://signed.example/" + k + "?sig=a%2Bb"}, nil
}
func (d *spy) PresignedPutObject(_ context.Context, k string, _ time.Duration, _ *s3.PutOption) (*s3.PresignedPutResult, error) {
	d.keys = append(d.keys, k)
	return &s3.PresignedPutResult{URL: "https://signed.example/" + k + "?sig=a%2Bb"}, nil
}
func (d *spy) StatObject(_ context.Context, k string) (*s3.ObjectInfo, error) {
	d.keys = append(d.keys, k)
	return &s3.ObjectInfo{Key: k, Size: 42}, nil
}
func (d *spy) CopyObject(_ context.Context, src, dst string) (*s3.CopyObjectInfo, error) {
	d.keys = append(d.keys, src, dst)
	return &s3.CopyObjectInfo{Key: dst}, nil
}
func (d *spy) ListUploadedParts(_ context.Context, _, k string, _, _ int) (*s3.ListUploadedPartsResult, error) {
	d.keys = append(d.keys, k)
	return &s3.ListUploadedPartsResult{Key: k}, nil
}
func (d *spy) AccessURL(_ context.Context, k string, _ time.Duration, _ *s3.AccessURLOption) (string, error) {
	d.keys = append(d.keys, k)
	return "https://signed.example/" + k + "?sig=a%2Bb", nil
}
func (d *spy) FormData(_ context.Context, k string, _ int64, _ string, _ time.Duration) (*s3.FormData, error) {
	d.keys = append(d.keys, k)
	return &s3.FormData{URL: "https://upload.example", FormData: map[string]string{"key": k, "policy": "untouched"}}, nil
}
func (d *spy) DeleteObject(_ context.Context, k string) error { d.keys = append(d.keys, k); return nil }
func (d *spy) AbortMultipartUpload(_ context.Context, _, k string) error {
	d.keys = append(d.keys, k)
	return nil
}

func operations(s *Store) map[string]func(string) error {
	c := context.Background()
	return map[string]func(string) error{
		"init":     func(k string) error { _, e := s.InitiateMultipartUpload(c, k, nil); return e },
		"complete": func(k string) error { _, e := s.CompleteMultipartUpload(c, "id", k, nil); return e },
		"auth":     func(k string) error { _, e := s.AuthSign(c, "id", k, time.Minute, nil); return e },
		"put":      func(k string) error { _, e := s.PresignedPutObject(c, k, time.Minute, nil); return e },
		"stat":     func(k string) error { _, e := s.StatObject(c, k); return e },
		"copy-src": func(k string) error { _, e := s.CopyObject(c, k, "dst"); return e },
		"copy-dst": func(k string) error { _, e := s.CopyObject(c, "src", k); return e },
		"parts":    func(k string) error { _, e := s.ListUploadedParts(c, "id", k, 0, 10); return e },
		"get":      func(k string) error { _, e := s.AccessURL(c, k, time.Minute, nil); return e },
		"form":     func(k string) error { _, e := s.FormData(c, k, 42, "image/jpeg", time.Minute); return e },
		"delete":   func(k string) error { return s.DeleteObject(c, k) },
		"abort":    func(k string) error { return s.AbortMultipartUpload(c, "id", k) },
	}
}
func TestEveryOperationRejectsEscapeBeforeDelegate(t *testing.T) {
	d := &spy{}
	s, _ := New(d, ProductionPrefix, "", false)
	for op, call := range operations(s) {
		t.Run(op, func(t *testing.T) {
			for _, key := range []string{"", "/root", "../outside", "a/../b", "a//b", "a/./b", "a\\b", "a%2fb", "a?b", "a#b", "https://host/a", ProductionPrefix + "already-prefixed", "a\x00b", "a\nb"} {
				if !errors.Is(call(key), ErrScope) {
					t.Fatalf("accepted %q", key)
				}
			}
		})
	}
	if len(d.keys) != 0 {
		t.Fatal("invalid operation reached shared storage")
	}
}
func TestAllPhysicalOperationsArePrefixed(t *testing.T) {
	d := &spy{}
	s, _ := New(d, ProductionPrefix, "", false)
	for op, call := range operations(s) {
		t.Run(op, func(t *testing.T) {
			if op == "delete" || op == "abort" {
				if !errors.Is(call("hash/abc"), ErrDeleteDisabled) {
					t.Fatal("deletion enabled")
				}
				return
			}
			if err := call("hash/abc"); err != nil {
				t.Fatal(err)
			}
		})
	}
	if len(d.keys) != 12 {
		t.Fatalf("unexpected delegate calls: %v", d.keys)
	}
	for _, k := range d.keys {
		if len(k) <= len(ProductionPrefix) || k[:len(ProductionPrefix)] != ProductionPrefix {
			t.Fatalf("unscoped physical key: %q", k)
		}
	}
}
func TestRelativeResultKeysAndSignedURLs(t *testing.T) {
	d := &spy{}
	s, _ := New(d, ProductionPrefix, "", false)
	c := context.Background()
	name := "hash/abc"
	a, _ := s.InitiateMultipartUpload(c, name, nil)
	b, _ := s.CompleteMultipartUpload(c, "id", name, nil)
	stat, _ := s.StatObject(c, name)
	copy, _ := s.CopyObject(c, "tmp", name)
	parts, _ := s.ListUploadedParts(c, "id", name, 0, 10)
	for _, k := range []string{a.Key, b.Key, stat.Key, copy.Key, parts.Key} {
		if k != name {
			t.Fatalf("result would be double prefixed: %q", k)
		}
	}
	if b.Location != "https://signed.example/exact%20key?sig=a%2Bb" {
		t.Fatal("rewrote OSS URL")
	}
	u, _ := s.AccessURL(c, name, time.Minute, nil)
	put, _ := s.PresignedPutObject(c, name, time.Minute, nil)
	auth, _ := s.AuthSign(c, "id", name, time.Minute, nil)
	for _, v := range []string{u, put.URL, auth.URL} {
		if v != "https://signed.example/"+ProductionPrefix+name+"?sig=a%2Bb" {
			t.Fatal("signed URL not preserved")
		}
	}
	form, _ := s.FormData(c, name, 42, "image/jpeg", time.Minute)
	if form.FormData["key"] != ProductionPrefix+name || form.FormData["policy"] != "untouched" {
		t.Fatal("form key/policy altered")
	}
	if s.Engine() != "ali-oss" {
		t.Fatal("metadata engine changed")
	}
}
func TestDeleteAndAbortOffByDefault(t *testing.T) {
	d := &spy{}
	s, _ := New(d, ProductionPrefix, "", false)
	c := context.Background()
	for _, e := range []error{s.DeleteObject(c, "hash/abc"), s.AbortMultipartUpload(c, "id", "tmp/abc")} {
		if !errors.Is(e, ErrDeleteDisabled) || s.IsNotFound(e) {
			t.Fatal("delete gate bypass")
		}
	}
	if len(d.keys) != 0 {
		t.Fatal("deletion reached cloud")
	}
	if _, err := New(d, ProductionPrefix, "", true); err == nil {
		t.Fatal("production deletion cannot be enabled")
	}
	for _, prefix := range []string{"", "production/", "oss-test/chat", "oss-test/business/"} {
		if _, err := New(d, prefix, "", false); err == nil {
			t.Fatal("unsafe prefix accepted")
		}
	}
}

// 未配置 IM_APP_CHAT_CDN_BASE 时必须能正常构造，且 AccessURL 逐字节回退到上游签名直链。
// 这条是上线安全带：少配一个环境变量不能让 openim-rpc-third 起不来。
func TestEmptyCDNBaseFallsBackToSignedURL(t *testing.T) {
	d := &spy{}
	s, err := New(d, ProductionPrefix, "", false)
	if err != nil {
		t.Fatalf("empty CDN base must be valid: %v", err)
	}
	for _, raw := range []string{"", "   ", "\n"} {
		if _, err := New(d, ProductionPrefix, raw, false); err != nil {
			t.Fatalf("blank CDN base %q must be valid: %v", raw, err)
		}
	}
	u, err := s.AccessURL(context.Background(), "hash/abc", time.Minute, nil)
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://signed.example/" + ProductionPrefix + "hash/abc?sig=a%2Bb"; u != want {
		t.Fatalf("fallback URL = %q, want %q", u, want)
	}
}

// 配置了 CDN 基址后，下载地址必须是无签名的 CDN 直链 + 图片处理参数，
// 且物理 key 仍带生产前缀 —— 前缀边界不能被 CDN 分支绕过。
func TestCDNBaseRewritesAccessURLOnly(t *testing.T) {
	const base = "https://oss-chat.whs188.xin"
	d := &spy{}
	for _, raw := range []string{base, base + "/", base + "//"} {
		s, err := New(d, ProductionPrefix, raw, false)
		if err != nil {
			t.Fatalf("New(%q): %v", raw, err)
		}
		if s.cdnBase != base {
			t.Fatalf("cdnBase = %q, want %q", s.cdnBase, base)
		}
	}
	s, _ := New(d, ProductionPrefix, base, false)
	c := context.Background()

	t.Run("no-image-option", func(t *testing.T) {
		u, err := s.AccessURL(c, "hash/abc", time.Minute, nil)
		if err != nil {
			t.Fatal(err)
		}
		if want := base + "/" + ProductionPrefix + "hash/abc"; u != want {
			t.Fatalf("got %q, want %q", u, want)
		}
	})
	t.Run("image-option", func(t *testing.T) {
		u, err := s.AccessURL(c, "hash/abc", time.Minute, &s3.AccessURLOption{
			Image: &s3.Image{Width: 360, Height: 360, Format: "webp"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if want := base + "/" + ProductionPrefix + "hash/abc?x-oss-process=image%2Fresize%2Cm_lfit%2Cw_360%2Ch_360%2Cformat%2Cwebp"; u != want {
			t.Fatalf("got %q, want %q", u, want)
		}
	})
	t.Run("key-scope-still-enforced", func(t *testing.T) {
		if _, err := s.AccessURL(c, "../outside", time.Minute, nil); !errors.Is(err, ErrScope) {
			t.Fatalf("CDN branch bypassed key scope: %v", err)
		}
	})
	t.Run("upload-path-unchanged", func(t *testing.T) {
		// 上传链路绝不能被 CDN 基址影响，必须继续走上游签名直链。
		put, _ := s.PresignedPutObject(c, "hash/abc", time.Minute, nil)
		if want := "https://signed.example/" + ProductionPrefix + "hash/abc?sig=a%2Bb"; put.URL != want {
			t.Fatalf("upload URL = %q, want %q", put.URL, want)
		}
	})

	// 非法基址必须被拒绝，绝不能静默降级成"看起来能跑"的地址。
	for _, bad := range []string{
		"http://oss-chat.whs188.xin",       // 非 HTTPS
		"https://oss-chat.whs188.xin/path", // 带路径
		"https://oss-chat.whs188.xin?a=b",  // 带查询串
		"https://user:pw@oss-chat.whs188.xin",
		"://not-a-url",
		// 注意：纯空白（"  \t "）属于「未配置」而非「非法」，
		// 由 TestEmptyCDNBaseFallsBackToSignedURL 覆盖，不能列在这里。
	} {
		if _, err := New(d, ProductionPrefix, bad, false); !errors.Is(err, ErrCDNConfig) {
			t.Fatalf("accepted unsafe CDN base %q", bad)
		}
	}
}
