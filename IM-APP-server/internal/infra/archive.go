package infra

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"im-app-server/internal/media"
)

const MaxArchiveBytes int64 = 512 << 20
const ArchiveTimeout = 45 * time.Second // Below the existing clients' default 60s request timeout.

var ErrArchive = errors.New("媒体副本保存失败，请稍后重试")

// Archive reads only explicitly configured application media locations. No
// credentials are attached to source requests; existing capability URLs apply.
type Archive struct {
	Storage    *Storage
	Prefixes   []string
	CDNRewrites []string
	BeforeCopy func(context.Context, string) error
	client     *http.Client
}

// WithCDNRewrites 注册媒体来源的 CDN 改写规则，留空表示不改写。
func (a *Archive) WithCDNRewrites(rules []string) *Archive {
	a.CDNRewrites = append([]string{}, rules...)
	return a
}

// cdnSource 把带签名的对象存储直连地址改写成 CDN 地址，并剥掉整段签名参数。
//
// OpenIM 给历史消息里的媒体地址签的是 7 天有效期，过期后转发/收藏再去下载
// 只会拿到 403。CDN 侧已开启私有 Bucket 回源，无需签名即可读取同一个私有
// 对象，因此换成 CDN 地址后旧消息也能继续归档，且地址稳定不过期。
// 规则形如 "https://源前缀->https://CDN前缀"；未命中任何规则时返回原地址。
func (a *Archive) cdnSource(raw string) string {
	for _, rule := range a.CDNRewrites {
		from, to, ok := strings.Cut(rule, "->")
		if !ok || from == "" || to == "" {
			continue
		}
		if !strings.HasPrefix(raw, from) {
			continue
		}
		rest := strings.TrimPrefix(raw, from)
		// 签名只属于源地址。带过去会让 CDN 把签名当成查询参数，
		// 既污染缓存键，又让地址重新变得会过期。
		if i := strings.Index(rest, "?"); i >= 0 {
			rest = rest[:i]
		}
		if rest == "" {
			return raw
		}
		return to + rest
	}
	return raw
}

func NewArchive(storage *Storage, prefixes []string) *Archive {
	a := &Archive{Storage: storage, Prefixes: append([]string{}, prefixes...)}
	if storage != nil && storage.OSS != nil {
		cfg := storage.OSS.cfg // Includes the validated default public upload origin.
		a.Prefixes = append(a.Prefixes, SourcePrefixes(nil, "", cfg.MediaProxyURL,
			cfg.PublicUploadURL, cfg.KeyPrefix, "", "")...)
		if cfg.PublicBaseURL != "" {
			a.Prefixes = append(a.Prefixes, strings.TrimRight(cfg.PublicBaseURL, "/")+"/"+cfg.KeyPrefix)
		}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = publicDial
	a.client = &http.Client{Timeout: 40 * time.Second, Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 || !a.allowed(req.URL.String()) {
				return ErrArchive
			}
			return nil
		}}
	return a
}

func publicDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, ErrArchive
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, ErrArchive
	}
	for _, item := range ips {
		ip := item.IP
		if !archivePublicIP(ip) {
			return nil, ErrArchive
		}
	}
	for _, item := range ips {
		conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(item.IP.String(), port))
		if err == nil {
			return conn, nil
		}
	}
	return nil, ErrArchive
}

func archivePublicIP(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// To4 is necessary: DNS may return IPv4-mapped 16-byte addresses.
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1]&192 == 64 {
			return false
		} // CGNAT, including cloud metadata.
	}
	for _, cidr := range []string{"192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "64:ff9b::/96", "64:ff9b:1::/48", "2001:db8::/32", "2002::/16"} {
		_, block, _ := net.ParseCIDR(cidr)
		if block.Contains(ip) {
			return false
		}
	}
	return true
}

func (a *Archive) allowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Fragment != "" || u.Opaque != "" || (u.Scheme != "https" && u.Scheme != "http") || !validURLPath(u.Path) {
		return false
	}
	for _, prefix := range a.Prefixes {
		p, err := url.Parse(prefix)
		if err != nil || p.Scheme != u.Scheme || !strings.EqualFold(p.Host, u.Host) || p.User != nil || p.RawQuery != "" || p.Fragment != "" || p.Path == "" || p.Path == "/" || !validURLPath(p.Path) {
			continue
		}
		if (strings.HasSuffix(p.Path, "/") && strings.HasPrefix(u.Path, p.Path)) || u.Path == p.Path {
			return true
		}
	}
	return false
}

func validURLPath(value string) bool {
	for _, part := range strings.Split(value, "/") {
		if part == "." || part == ".." || strings.ContainsAny(part, "%\\\x00\r\n") {
			return false
		}
	}
	return true
}

func (a *Archive) Preserve(ctx context.Context, userID, messageID, kind, content string) (string, error) {
	if !media.IsMedia(kind) {
		return content, nil
	}
	return a.preserve(ctx, "favorites", userID, messageID, content, media.Rewrite, true)
}

// PreserveForward uses a separate namespace, including nested quote/merge
// media. It never changes the source object or relies on a source chat lifetime.
func (a *Archive) PreserveForward(ctx context.Context, userID, messageID, content string) (string, error) {
	return a.preserve(ctx, "forwards", userID, messageID, content, media.RewriteForward, false)
}

func (a *Archive) preserve(ctx context.Context, namespace, userID, messageID, content string,
	rewrite func(context.Context, string, func(context.Context, string) (string, error)) (string, int, error), requireURL bool) (string, error) {
	if a == nil || !a.Storage.Available() {
		return "", ErrArchive
	}
	ctx, cancel := context.WithTimeout(ctx, ArchiveTimeout)
	defer cancel()
	remaining := MaxArchiveBytes // Limit the whole snapshot, not 64 separate 512 MiB files.
	cache := map[string]string{}
	out, count, err := rewrite(ctx, content, func(ctx context.Context, source string) (string, error) {
		if saved, ok := cache[source]; ok {
			return saved, nil
		}
		saved, size, err := a.copy(ctx, namespace, userID, messageID, source, remaining)
		if err != nil {
			return "", err
		}
		remaining -= size
		cache[source] = saved
		return saved, nil
	})
	if err != nil || (requireURL && count == 0) {
		return "", ErrArchive
	}
	return out, nil
}

func (a *Archive) copy(ctx context.Context, namespace, userID, messageID, source string, limit int64) (string, int64, error) {
	if !validStorageKey(userID) || strings.Contains(userID, "/") || limit <= 0 || !a.allowed(source) {
		return "", 0, ErrArchive
	}
	// 历史消息里的签名地址会过期，下载前先改写成不会过期的 CDN 地址。
	// 改写结果必须同样落在白名单内：改写只能换前缀，不能把下载地址带出受信任范围。
	source = a.cdnSource(source)
	if !a.allowed(source) {
		return "", 0, ErrArchive
	}
	if a.BeforeCopy != nil {
		if err := a.BeforeCopy(ctx, source); err != nil {
			return "", 0, ErrArchive
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return "", 0, ErrArchive
	}
	res, err := a.client.Do(req)
	if err != nil {
		return "", 0, ErrArchive
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || res.ContentLength > limit {
		return "", 0, ErrArchive
	}
	tmp, err := os.CreateTemp("", "im-media-archive-*")
	if err != nil {
		return "", 0, ErrArchive
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	digest := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, digest), io.LimitReader(res.Body, limit+1))
	if err != nil || size <= 0 || size > limit || (res.ContentLength >= 0 && size != res.ContentLength) {
		return "", 0, ErrArchive
	}
	if _, err = tmp.Seek(0, io.SeekStart); err != nil {
		return "", 0, ErrArchive
	}
	contentType := res.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	messageHash := sha256.Sum256([]byte(messageID))
	// Content-addressed key independent of MIME headers, OS MIME databases and expiring URLs.
	logical := path.Join(namespace, userID, hex.EncodeToString(messageHash[:16]), hex.EncodeToString(digest.Sum(nil)))
	store := a.Storage.Current
	key, err := store.NewKey(logical)
	if err != nil {
		return "", 0, ErrArchive
	}
	stable := store.FileURL(key)
	if stable == "" {
		return "", 0, ErrArchive
	}
	info, statErr := store.Stat(ctx, key)
	if statErr == nil {
		if info.Size != size {
			return "", 0, ErrArchive
		}
		return stable, size, nil
	}
	if !errors.Is(statErr, ErrObjectNotFound) {
		return "", 0, ErrArchive
	}
	if ossStore, ok := store.(*OSS); ok {
		err = ossStore.putArchive(ctx, key, tmp, size, contentType)
	} else {
		err = store.PutObject(ctx, key, tmp, size, contentType)
	}
	if err != nil {
		// A concurrent retry may have finished this deterministic object first.
		if info, statErr := store.Stat(ctx, key); statErr != nil || info.Size != size {
			return "", 0, ErrArchive
		}
	}
	return stable, size, nil
}

// SourcePrefixes restricts archive downloads, including every redirect hop.
func SourcePrefixes(explicit []string, publicAPI, mediaProxy, uploadOrigin, prefix, legacyPublic, legacyBucket string) []string {
	result := append([]string{}, explicit...)
	if u, err := url.Parse(publicAPI); err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" {
		result = append(result, fmt.Sprintf("%s://%s/object/", u.Scheme, u.Host))
	}
	if mediaProxy != "" {
		result = append(result, mediaProxy)
	}
	if uploadOrigin != "" && prefix != "" {
		result = append(result, strings.TrimSuffix(uploadOrigin, "/")+"/"+prefix)
	}
	if legacyPublic != "" && legacyBucket != "" {
		result = append(result, strings.TrimSuffix(legacyPublic, "/")+"/"+legacyBucket+"/")
	}
	return result
}

// ValidateArchiveSources is offline and reports no signed URLs or credentials.
// Object resolver paths may be exact; object directories must end in a slash.
func ValidateArchiveSources(prefixes []string) error {
	for i, raw := range prefixes {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil ||
			u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.Path == "" || u.Path == "/" || !validURLPath(u.Path) {
			return fmt.Errorf("invalid MEDIA_SOURCE_URL_PREFIXES entry %d: require a scoped HTTP(S) path without credentials or query", i+1)
		}
		if ip := net.ParseIP(u.Hostname()); ip != nil && !archivePublicIP(ip) {
			return fmt.Errorf("invalid MEDIA_SOURCE_URL_PREFIXES entry %d: public address required", i+1)
		}
	}
	return nil
}
