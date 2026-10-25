package media

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
)

// ValidateForwardContent checks every referenced media message independently.
// A sibling thumbnail/attachment must not hide a missing primary file. Both
// native element fields and serialized content are checked when both exist.
func ValidateForwardContent(ctx context.Context, kind int, content string) error {
	if len(content) > MaxContentBytes {
		return ErrContent
	}
	return validateForwardValue(ctx, kind, content, 0)
}

var forwardElement = map[int]string{
	102: "pictureElem", 103: "soundElem", 104: "videoElem", 105: "fileElem",
	106: "atTextElem", 107: "mergeElem", 114: "quoteElem",
}

func forwardDecoded(value any) any {
	for i := 0; i < 4; i++ {
		raw, ok := value.(string)
		if !ok || !json.Valid([]byte(raw)) {
			break
		}
		decoder := json.NewDecoder(strings.NewReader(raw))
		decoder.UseNumber()
		if decoder.Decode(&value) != nil {
			return nil
		}
	}
	return value
}

func forwardFields(value map[string]any, name string) []any {
	var fields []any
	for key, item := range value {
		if strings.EqualFold(key, name) {
			fields = append(fields, item)
		}
	}
	return fields
}

func forwardRemote(value map[string]any, names ...string) bool {
	for _, name := range names {
		for _, item := range forwardFields(value, name) {
			if raw, ok := item.(string); ok && remoteURL(strings.TrimSpace(raw)) {
				return true
			}
		}
	}
	return false
}

func validateForwardValue(ctx context.Context, kind int, value any, depth int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if depth > 16 {
		return ErrContent
	}
	name, mediaOrReference := forwardElement[kind]
	if !mediaOrReference {
		return nil // Ordinary text, mentions without media, cards, etc.
	}
	obj, ok := forwardDecoded(value).(map[string]any)
	if !ok {
		return ErrContent
	}
	// A nested full MessageItem may hold its payload twice. Validate both so
	// neither SDK casing nor content/element preference can bypass validation.
	var payloads []any
	payloads = append(payloads, forwardFields(obj, name)...)
	for _, content := range forwardFields(obj, "content") {
		payloads = append(payloads, content)
	}
	if len(payloads) > 0 {
		for _, payload := range payloads {
			if err := validateForwardValue(ctx, kind, payload, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	switch kind {
	case 102:
		pictures := forwardFields(obj, "sourcePicture")
		if len(pictures) == 0 {
			if !forwardRemote(obj, "url", "sourceUrl") {
				return ErrContent
			}
		}
		for _, picture := range pictures {
			p, ok := forwardDecoded(picture).(map[string]any)
			if !ok || !forwardRemote(p, "url") {
				return ErrContent
			}
		}
		for _, name := range []string{"bigPicture", "snapshotPicture"} {
			for _, picture := range forwardFields(obj, name) {
				p, ok := forwardDecoded(picture).(map[string]any)
				if !ok || !forwardRemote(p, "url") {
					return ErrContent
				}
			}
		}
	case 103:
		if !forwardRemote(obj, "sourceUrl", "soundUrl", "audioUrl", "soundPath", "audioPath", "url", "path") {
			return ErrContent
		}
	case 104:
		if !forwardRemote(obj, "videoUrl", "videoPath", "url") || !forwardRemote(obj, "snapshotUrl", "snapshotPath") {
			return ErrContent
		}
	case 105:
		if !forwardRemote(obj, "sourceUrl", "fileUrl", "downloadUrl", "filePath", "url", "path") {
			return ErrContent
		}
	case 106, 114:
		quotes := forwardFields(obj, "quoteMessage")
		if kind == 114 && len(quotes) == 0 {
			return ErrContent
		}
		for _, quote := range quotes {
			if quote == nil && kind == 106 {
				continue
			}
			if err := validateForwardMessage(ctx, quote, depth+1); err != nil {
				return err
			}
		}
	case 107:
		lists := forwardFields(obj, "multiMessage")
		if len(lists) == 0 {
			return ErrContent
		}
		for _, list := range lists {
			messages, ok := forwardDecoded(list).([]any)
			if !ok || len(messages) == 0 {
				return ErrContent
			}
			for _, message := range messages {
				if err := validateForwardMessage(ctx, message, depth+1); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func validateForwardMessage(ctx context.Context, value any, depth int) error {
	obj, ok := forwardDecoded(value).(map[string]any)
	if !ok {
		return ErrContent
	}
	fields := forwardFields(obj, "contentType")
	if len(fields) == 0 {
		return ErrContent
	}
	kind := 0
	for _, field := range fields {
		number, ok := field.(json.Number)
		if !ok {
			return ErrContent
		}
		parsed, err := strconv.Atoi(number.String())
		if err != nil || parsed <= 0 || parsed >= 1000 || (kind != 0 && parsed != kind) {
			return ErrContent
		}
		kind = parsed
	}
	return validateForwardValue(ctx, kind, obj, depth)
}
