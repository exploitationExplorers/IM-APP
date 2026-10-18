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
		Mode       string
		Candidates []struct{ Seq int64 }
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Mode != "preview_only" || len(result.Candidates) != 1 || result.Candidates[0].Seq != 2 {
		t.Fatalf("bad output: %s", out.String())
	}
	for _, invalid := range []string{`{}`, input + `{}`, `{"messages":`} {
		out.Reset()
		if err := preview(strings.NewReader(invalid), &out); err == nil || out.Len() != 0 {
			t.Fatal("unsafe input produced plan")
		}
	}
}
