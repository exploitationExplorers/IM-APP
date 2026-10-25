// Package scopedoss is a PRODUCTION physical-key boundary for pinned OpenIM.
// Logical names/hashes in Mongo/Redis remain relative; signed URLs
// and POST fields contain the prefixed physical OSS key and are never rewritten.
package scopedoss

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/openimsdk/tools/s3"
)

const ProductionPrefix = "im-app-production/chat/"

var (
	ErrScope          = errors.New("OpenIM OSS production key outside scope")
	ErrDeleteDisabled = errors.New("OpenIM OSS production deletion disabled")
	ErrCDNConfig      = errors.New("OpenIM chat CDN base must be a clean HTTPS origin")
)

// Do not embed s3.Interface: adding an upstream method must fail compilation,
// rather than silently delegating an unprefixed operation to the shared bucket.
type Store struct {
	delegate    s3.Interface
	prefix      string
	cdnBase     string
	allowDelete bool
}

var _ s3.Interface = (*Store)(nil)

func New(delegate s3.Interface, prefix, cdnBase string, allowDelete bool) (*Store, error) {
	if delegate == nil || delegate.Engine() != "ali-oss" || prefix != ProductionPrefix || allowDelete {
		return nil, ErrScope
	}
	cdnBase, err := normalizeCDNBase(cdnBase)
	if err != nil {
		return nil, err
	}
	return &Store{delegate: delegate, prefix: prefix, cdnBase: cdnBase, allowDelete: allowDelete}, nil
}

func normalizeCDNBase(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	// 容忍尾斜杠：环境变量很容易被写成 `https://host/` 甚至 `https://host//`。
	// 必须在判空之前去掉，否则 "//" 会被 url.Parse 当成非空 Path 而误判为非法。
	raw = strings.TrimRight(raw, "/")
	if raw == "" {
		// 未配置 CDN 是合法状态：AccessURL 会回退到上游的签名直链。
		// 绝不能因为少配一个环境变量就让 openim-rpc-third 起不来。
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" ||
		u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", ErrCDNConfig
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}

func (s *Store) key(name string) (string, error) {
	if name == "" || strings.HasPrefix(name, "/") || strings.HasPrefix(name, s.prefix) || strings.ContainsAny(name, "\\%\x00\r\n?#:") {
		return "", ErrScope
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return "", ErrScope
		}
	}
	return s.prefix + name, nil
}

func (s *Store) Engine() string                    { return s.delegate.Engine() }
func (s *Store) PartLimit() (*s3.PartLimit, error) { return s.delegate.PartLimit() }
func (s *Store) PartSize(ctx context.Context, size int64) (int64, error) {
	return s.delegate.PartSize(ctx, size)
}
func (s *Store) IsNotFound(err error) bool {
	if errors.Is(err, ErrScope) || errors.Is(err, ErrDeleteDisabled) || errors.Is(err, ErrCDNConfig) {
		return false
	}
	return s.delegate.IsNotFound(err)
}

func (s *Store) InitiateMultipartUpload(ctx context.Context, name string, opt *s3.PutOption) (*s3.InitiateMultipartUploadResult, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	r, err := s.delegate.InitiateMultipartUpload(ctx, key, opt)
	if err != nil || r == nil {
		return r, err
	}
	copy := *r
	copy.Key = name
	return &copy, nil
}
func (s *Store) CompleteMultipartUpload(ctx context.Context, id, name string, parts []s3.Part) (*s3.CompleteMultipartUploadResult, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	r, err := s.delegate.CompleteMultipartUpload(ctx, id, key, parts)
	if err != nil || r == nil {
		return r, err
	}
	copy := *r
	copy.Key = name
	return &copy, nil
}
func (s *Store) AuthSign(ctx context.Context, id, name string, expire time.Duration, parts []int) (*s3.AuthSignResult, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	return s.delegate.AuthSign(ctx, id, key, expire, parts)
}
func (s *Store) PresignedPutObject(ctx context.Context, name string, expire time.Duration, opt *s3.PutOption) (*s3.PresignedPutResult, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	return s.delegate.PresignedPutObject(ctx, key, expire, opt)
}
func (s *Store) StatObject(ctx context.Context, name string) (*s3.ObjectInfo, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	r, err := s.delegate.StatObject(ctx, key)
	if err != nil || r == nil {
		return r, err
	}
	copy := *r
	copy.Key = name
	return &copy, nil
}
func (s *Store) CopyObject(ctx context.Context, src, dst string) (*s3.CopyObjectInfo, error) {
	srcKey, err := s.key(src)
	if err != nil {
		return nil, err
	}
	dstKey, err := s.key(dst)
	if err != nil {
		return nil, err
	}
	r, err := s.delegate.CopyObject(ctx, srcKey, dstKey)
	if err != nil || r == nil {
		return r, err
	}
	copy := *r
	copy.Key = dst
	return &copy, nil
}
func (s *Store) ListUploadedParts(ctx context.Context, id, name string, marker, max int) (*s3.ListUploadedPartsResult, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	r, err := s.delegate.ListUploadedParts(ctx, id, key, marker, max)
	if err != nil || r == nil {
		return r, err
	}
	copy := *r
	copy.Key = name
	return &copy, nil
}
func (s *Store) AccessURL(ctx context.Context, name string, expire time.Duration, opt *s3.AccessURLOption) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	key, err := s.key(name)
	if err != nil {
		return "", err
	}
	if s.cdnBase == "" {
		// 未配置 CDN：完全沿用上游（patch 版 CNAME 签名）的直链行为，
		// 保证开箱不配置时与今天的线上表现逐字节一致。
		return s.delegate.AccessURL(ctx, key, expire, opt)
	}
	u, err := url.Parse(s.cdnBase)
	if err != nil {
		return "", ErrCDNConfig
	}
	u.Path = "/" + key
	if process := imageProcess(opt); process != "" {
		query := u.Query()
		query.Set("x-oss-process", process)
		u.RawQuery = query.Encode()
	}
	return u.String(), nil
}

func imageProcess(opt *s3.AccessURLOption) string {
	if opt == nil || opt.Image == nil {
		return ""
	}
	format := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(opt.Image.Format), "."))
	switch format {
	case "png", "jpg", "jpeg", "gif", "webp":
	default:
		format = "jpg"
	}
	process := "image/resize,m_lfit"
	if opt.Image.Width > 0 {
		process += ",w_" + strconv.Itoa(opt.Image.Width)
	}
	if opt.Image.Height > 0 {
		process += ",h_" + strconv.Itoa(opt.Image.Height)
	}
	return process + ",format," + format
}
func (s *Store) FormData(ctx context.Context, name string, size int64, contentType string, expire time.Duration) (*s3.FormData, error) {
	key, err := s.key(name)
	if err != nil {
		return nil, err
	}
	return s.delegate.FormData(ctx, key, size, contentType, expire)
}
func (s *Store) DeleteObject(ctx context.Context, name string) error {
	key, err := s.key(name)
	if err != nil {
		return err
	}
	if !s.allowDelete {
		return ErrDeleteDisabled
	}
	return s.delegate.DeleteObject(ctx, key)
}
func (s *Store) AbortMultipartUpload(ctx context.Context, id, name string) error {
	key, err := s.key(name)
	if err != nil {
		return err
	}
	if !s.allowDelete {
		return ErrDeleteDisabled
	}
	return s.delegate.AbortMultipartUpload(ctx, id, key)
}
