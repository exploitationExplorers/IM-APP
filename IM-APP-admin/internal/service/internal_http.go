package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// callServerInternal 调 server /internal/* 内部接口（方案 A：写操作由 server 执行业务 + OpenIM 同步）
// 返回响应体（调用方按需解析），非 2xx 返回错误
func callServerInternal(ctx context.Context, baseURL, key, path string, payload map[string]any) ([]byte, error) {
	return callServerInternalMethod(ctx, http.MethodPost, baseURL, key, path, payload)
}

func callServerInternalMethod(ctx context.Context, method, baseURL, key, path string, payload map[string]any) ([]byte, error) {
	if baseURL == "" {
		return nil, errors.New("未配置 server 内部接口地址")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var reader io.Reader
	if method != http.MethodGet {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-API-Key", key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("调用 server 失败: %w", err)
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("server 返回 %d: %s", resp.StatusCode, string(rb))
	}
	return rb, nil
}
