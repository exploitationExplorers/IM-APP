// Package media contains storage-independent media parsing and retention rules.
package media

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"
)

var ErrContent = errors.New("媒体内容无效或媒体文件不存在")

const MaxContentBytes = 64 << 10

var urlFields = map[string]bool{
	"url": true, "sourceurl": true, "snapshoturl": true, "videourl": true,
	"fileurl": true, "soundurl": true, "audiourl": true, "downloadurl": true,
	"path": true, "videopath": true, "snapshotpath": true, "soundpath": true,
	"audiopath": true, "filepath": true,
}

func IsMedia(kind string) bool {
	return kind == "image" || kind == "voice" || kind == "video" || kind == "file"
}

// Rewrite preserves field casing and the string/JSON shape used by older App
// bridges. It traverses quote/merge snapshots and JSON encoded inside content.
func Rewrite(ctx context.Context, content string, replace func(context.Context, string) (string, error)) (string, int, error) {
	if len(content) > MaxContentBytes {
		return "", 0, ErrContent
	}
	count := 0
	var walk func(any, int, bool) (any, error)
	walk = func(value any, depth int, isURL bool) (any, error) {
		if depth > 16 || count > 64 {
			return nil, ErrContent
		}
		switch value := value.(type) {
		case string:
			trimmed := strings.TrimSpace(value)
			if isURL && remoteURL(trimmed) {
				count++
				if count > 64 {
					return nil, ErrContent
				}
				return replace(ctx, trimmed)
			}
			if isURL && (strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "\"")) {
				var nested any
				decoder := json.NewDecoder(strings.NewReader(trimmed))
				decoder.UseNumber() // Native SDK identifiers may exceed JavaScript's safe integer range.
				if json.Valid([]byte(trimmed)) && decoder.Decode(&nested) == nil {
					out, err := walk(nested, depth+1, isURL)
					if err != nil {
						return nil, err
					}
					encoded, err := json.Marshal(out)
					return string(encoded), err
				}
				return nil, ErrContent
			}
			return value, nil
		case map[string]any:
			keys := make([]string, 0, len(value))
			for key := range value {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				item := value[key]
				out, err := walk(item, depth+1, urlFields[strings.ToLower(key)] || strings.EqualFold(key, "content"))
				if err != nil {
					return nil, err
				}
				value[key] = out
			}
			return value, nil
		case []any:
			for i, item := range value {
				out, err := walk(item, depth+1, isURL)
				if err != nil {
					return nil, err
				}
				value[i] = out
			}
			return value, nil
		default:
			return value, nil
		}
	}
	out, err := walk(content, 0, true)
	if err != nil {
		return "", count, err
	}
	rewritten := out.(string)
	if len(rewritten) > MaxContentBytes {
		return "", count, ErrContent
	}
	return rewritten, count, nil
}

func URLs(content string) ([]string, error) {
	seen := map[string]bool{}
	var urls []string
	_, _, err := Rewrite(context.Background(), content, func(_ context.Context, raw string) (string, error) {
		if !seen[raw] {
			seen[raw] = true
			urls = append(urls, raw)
		}
		return raw, nil
	})
	return urls, err
}

func remoteURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && u.Fragment == ""
}
