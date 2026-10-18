// Package media contains storage-independent media parsing and retention rules.
package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	return rewrite(ctx, content, replace, true)
}

// RewriteForward parses embedded message JSON without treating quoted text
// such as {"content":"https://example.com"} as a downloadable media file.
func RewriteForward(ctx context.Context, content string, replace func(context.Context, string) (string, error)) (string, int, error) {
	return rewrite(ctx, content, replace, false)
}

func rewrite(ctx context.Context, content string, replace func(context.Context, string) (string, error), rawContentURL bool) (string, int, error) {
	if len(content) > MaxContentBytes {
		return "", 0, ErrContent
	}
	count := 0
	var walk func(any, int, bool, bool) (any, error)
	walk = func(value any, depth int, isURL, parseJSON bool) (any, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
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
			if parseJSON && (strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "\"")) {
				var nested any
				decoder := json.NewDecoder(strings.NewReader(trimmed))
				decoder.UseNumber() // Native SDK identifiers may exceed JavaScript's safe integer range.
				if json.Valid([]byte(trimmed)) && decoder.Decode(&nested) == nil {
					out, err := walk(nested, depth+1, isURL, parseJSON)
					if err != nil {
						return nil, err
					}
					encoded, err := json.Marshal(out)
					return string(encoded), err
				}
				if rawContentURL {
					return nil, ErrContent
				}
			}
			return value, nil
		case map[string]any:
			textMessage := false
			if !rawContentURL {
				for key, item := range value {
					if strings.EqualFold(key, "contentType") {
						textMessage = fmt.Sprint(item) == "101"
					}
				}
			}
			keys := make([]string, 0, len(value))
			for key := range value {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				item := value[key]
				if !rawContentURL && (strings.EqualFold(key, "textElem") || (textMessage && strings.EqualFold(key, "content"))) {
					continue
				}
				isContent := strings.EqualFold(key, "content")
				isURL := urlFields[strings.ToLower(key)] || (isContent && rawContentURL)
				isJSON := isURL || isContent || strings.EqualFold(key, "multiMessage") || strings.EqualFold(key, "quoteMessage")
				out, err := walk(item, depth+1, isURL, isJSON)
				if err != nil {
					return nil, err
				}
				value[key] = out
			}
			return value, nil
		case []any:
			for i, item := range value {
				out, err := walk(item, depth+1, isURL, parseJSON)
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
	out, err := walk(content, 0, rawContentURL, true)
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
