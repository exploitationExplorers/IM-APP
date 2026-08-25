package infra

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestComputeFingerprint_Deterministic(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	req.Header.Set("Sec-CH-UA", `"Chromium";v="120", "Google Chrome";v="120"`)
	req.Header.Set("Sec-CH-UA-Platform", `"Windows"`)

	fp1, suspicious1 := ComputeFingerprint(req)
	fp2, suspicious2 := ComputeFingerprint(req)

	if fp1 != fp2 {
		t.Errorf("same input should produce same fingerprint, got %s and %s", fp1, fp2)
	}
	if len(fp1) != 32 {
		t.Errorf("fingerprint should be 32 hex chars, got %d", len(fp1))
	}
	if suspicious1 != suspicious2 {
		t.Errorf("same input should produce same suspicious flag")
	}
}

func TestComputeFingerprint_DifferentHeaders(t *testing.T) {
	req1 := httptest.NewRequest(http.MethodPost, "/", nil)
	req1.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0)")
	req1.Header.Set("Sec-CH-UA-Platform", `"Windows"`)

	req2 := httptest.NewRequest(http.MethodPost, "/", nil)
	req2.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
	req2.Header.Set("Sec-CH-UA-Platform", `"macOS"`)

	fp1, _ := ComputeFingerprint(req1)
	fp2, _ := ComputeFingerprint(req2)

	if fp1 == fp2 {
		t.Error("different User-Agent should produce different fingerprints")
	}
}

func TestComputeFingerprint_EmptyHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	// 不设置任何 Header
	fp, suspicious := ComputeFingerprint(req)

	if fp == "" {
		t.Error("fingerprint should not be empty even with no headers")
	}
	if len(fp) != 32 {
		t.Errorf("fingerprint should be 32 hex chars, got %d", len(fp))
	}
	if suspicious {
		t.Error("empty headers should not be marked suspicious (no Client Hints to compare)")
	}
}

func TestComputeFingerprint_SuspiciousInconsistency(t *testing.T) {
	// UA 声明 Windows，但 Client Hints 报 macOS
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	req.Header.Set("Sec-CH-UA-Platform", `"macOS"`)

	_, suspicious := ComputeFingerprint(req)
	if !suspicious {
		t.Error("UA=Windows + CH-Platform=macOS should be suspicious")
	}
}

func TestComputeFingerprint_ConsistentPlatform(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	req.Header.Set("Sec-CH-UA-Platform", `"Windows"`)

	_, suspicious := ComputeFingerprint(req)
	if suspicious {
		t.Error("UA=Windows + CH-Platform=Windows should not be suspicious")
	}
}

func TestComputeFingerprint_AndroidConsistent(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Linux; Android 13; Pixel 7)")
	req.Header.Set("Sec-CH-UA-Platform", `"Android"`)

	_, suspicious := ComputeFingerprint(req)
	if suspicious {
		t.Error("UA=Android + CH-Platform=Android should not be suspicious")
	}
}

func TestComputeFingerprint_iOSConsistent(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")
	req.Header.Set("Sec-CH-UA-Platform", `"iOS"`)

	_, suspicious := ComputeFingerprint(req)
	if suspicious {
		t.Error("UA=iPhone + CH-Platform=iOS should not be suspicious")
	}
}

func TestDetectInconsistency_NoClientHints(t *testing.T) {
	// 无 Client Hints 时不判定
	if detectInconsistency("Mozilla/5.0 (Windows NT 10.0)", "") {
		t.Error("empty chPlatform should not trigger suspicious")
	}
}
