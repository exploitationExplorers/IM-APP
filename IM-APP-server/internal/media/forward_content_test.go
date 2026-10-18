package media

import (
	"context"
	"testing"
)

func TestValidateForwardMediaPerReferencedMessage(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind int
		raw  string
		ok   bool
	}{
		{"picture", 102, `{"SourcePicture":{"Url":"https://chat.example/a"}}`, true},
		{"thumbnail_only", 102, `{"SnapshotPicture":{"Url":"https://chat.example/a"},"sourcePath":"file:///local"}`, false},
		{"local_thumbnail_with_remote_source", 102, `{"sourcePicture":{"url":"https://chat.example/a"},"snapshotPicture":{"url":"file:///local"}}`, false},
		{"video_and_cover", 104, `{"VideoUrl":"https://chat.example/v","SnapshotUrl":"https://chat.example/c"}`, true},
		{"video_cover_only", 104, `{"VideoPath":"file:///local","SnapshotUrl":"https://chat.example/c"}`, false},
		{"missing_video_cover", 104, `{"VideoUrl":"https://chat.example/v"}`, false},
		{"file_remote_path", 105, `{"FilePath":"https://chat.example/f","FileSize":9007199254740993}`, true},
		{"local_voice", 103, `{"SoundPath":"file:///local"}`, false},
		{"text_json_is_text", 101, `{"content":"{\"url\":\"https://outside.example/x\"}"}`, true},
		{"plain_mention", 106, `{"text":"@name hello","quoteMessage":null}`, true},
		{"quoted_local_file", 114, `{"text":"reply","quoteMessage":{"contentType":105,"fileElem":{"filePath":"file:///local"}}}`, false},
		{"quoted_native_voice", 114, `{"Text":"reply","QuoteMessage":"{\"ContentType\":103,\"Content\":\"{\\\"SourceUrl\\\":\\\"https://chat.example/v\\\"}\"}"}`, true},
		{"merged_text_and_voice", 107, `{"multiMessage":[{"contentType":101,"content":"hello"},{"ContentType":103,"SoundElem":{"SourceUrl":"https://chat.example/a"}}]}`, true},
		{"sibling_url_cannot_hide_local_file", 107, `{"multiMessage":[{"contentType":102,"pictureElem":{"sourcePicture":{"url":"https://chat.example/a"}}},{"ContentType":105,"FileElem":{"FilePath":"file:///local"}}]}`, false},
		{"valid_element_cannot_hide_local_content", 107, `{"multiMessage":[{"contentType":103,"soundElem":{"sourceUrl":"https://chat.example/a"},"Content":"{\"SoundPath\":\"file:///local\"}"}]}`, false},
		{"invalid_duplicate_element", 107, `{"multiMessage":[{"contentType":103,"soundElem":{"sourceUrl":"https://chat.example/a"},"SoundElem":{"SoundPath":"file:///local"}}]}`, false},
		{"conflicting_types", 114, `{"quoteMessage":{"contentType":101,"ContentType":105,"content":"hello"}}`, false},
		{"unknown_quoted_type", 114, `{"quoteMessage":{"fileElem":{"sourceUrl":"https://chat.example/a"}}}`, false},
		{"empty_merge", 107, `{"multiMessage":[]}`, false},
		{"merge_control_message", 107, `{"multiMessage":[{"contentType":1001,"content":{}}]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateForwardContent(context.Background(), tc.kind, tc.raw)
			if (err == nil) != tc.ok {
				t.Fatalf("valid=%v want=%v error=%v", err == nil, tc.ok, err)
			}
		})
	}
}
