package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestPreviewProducesOnlyReadOnlyPlan(t *testing.T) {
	input := `{"conversationId":"sg_group","sessionType":"group","serverTime":"2026-10-18T03:00:00+08:00","committedWatermark":50,"complete":true,"messages":[{"seq":2,"sendTime":"2026-10-01T00:00:00Z","visibility":"visible"}]}`
	var out bytes.Buffer
	if err := preview(strings.NewReader(input), &out); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Mode       string          `json:"mode"`
		Kept       []int64         `json:"keptSeqs"`
		Candidates []struct{ Seq int64 }
	}
	// Over-age but under default 3000 quota → union keeps it (不足条数也保存).
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Mode != "preview_only" ||
		len(result.Candidates) != 0 || len(result.Kept) != 1 || result.Kept[0] != 2 {
		t.Fatalf("bad output: %s", out.String())
	}
	for _, invalid := range []string{`{}`, input + `{}`, `{"messages":`} {
		out.Reset()
		if err := preview(strings.NewReader(invalid), &out); err == nil || out.Len() != 0 {
			t.Fatal("unsafe input produced plan")
		}
	}
}
