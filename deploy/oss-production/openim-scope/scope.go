// Package scopedoss is a PRODUCTION physical-key boundary for pinned OpenIM.
// Logical names/hashes in Mongo/Redis remain relative; signed URLs
// and POST fields contain the prefixed physical OSS key and are never rewritten.
package scopedoss

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/openimsdk/tools/s3"
)

const ProductionPrefix = "im-app-production/chat/"

var (
	ErrScope          = errors.New("OpenIM OSS production key outside scope")
	ErrDeleteDisabled = errors.New("OpenIM OSS production deletion disabled")
)

// Do not embed s3.Interface: adding an upstream method must fail compilation,
// rather than silently delegating an unprefixed operation to the shared bucket.
type Store struct {
	delegate    s3.Interface
	prefix      string
	allowDelete bool
}

var _ s3.Interface = (*Store)(nil)

func New(delegate s3.Interface, prefix string, allowDelete bool) (*Store, error) {
	if delegate == nil || delegate.Engine() != "ali-oss" || prefix != ProductionPrefix || allowDelete {
		return nil, ErrScope
	}
	return &Store{delegate: delegate, prefix: prefix, allowDelete: allowDelete}, nil
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
	if errors.Is(err, ErrScope) || errors.Is(err, ErrDeleteDisabled) {
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
	key, err := s.key(name)
	if err != nil {
		return "", err
	}
	return s.delegate.AccessURL(ctx, key, expire, opt)
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
