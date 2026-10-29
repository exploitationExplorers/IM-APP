package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk/requests"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrRejected    = errors.New("内容未通过审核，请修改后重试")
	ErrUnavailable = errors.New("内容审核暂不可用，请稍后重试")
)

type Client struct {
	Region, AccessKeyID, AccessKeySecret, TextService, ImageService string
	Transport                                                       http.RoundTripper
}

// 开启后必须配置真实阿里云内容安全增强版服务；缺失配置直接阻止启动。
func FromEnv() (*Client, error) {
	enabled, err := flag("CONTENT_MODERATION_ENABLED")
	if err != nil {
		return nil, err
	}
	storeReady, err := flag("APP_STORE_READY")
	if err != nil {
		return nil, err
	}
	if storeReady && !enabled {
		return nil, errors.New("APP_STORE_READY requires CONTENT_MODERATION_ENABLED=true")
	}
	if !enabled {
		return nil, nil
	}
	c := &Client{Region: env("CONTENT_MODERATION_REGION", "cn-shanghai"), AccessKeyID: os.Getenv("CONTENT_MODERATION_ACCESS_KEY_ID"), AccessKeySecret: os.Getenv("CONTENT_MODERATION_ACCESS_KEY_SECRET"), TextService: env("CONTENT_MODERATION_TEXT_SERVICE", "chat_detection"), ImageService: env("CONTENT_MODERATION_IMAGE_SERVICE", "baselineCheck")}
	if c.AccessKeyID == "" || c.AccessKeySecret == "" {
		return nil, errors.New("content moderation credentials are required")
	}
	switch c.Region {
	case "cn-shanghai", "cn-beijing", "cn-shenzhen", "ap-southeast-1":
	default:
		return nil, errors.New("unsupported content moderation region")
	}
	return c, nil
}
func flag(key string) (bool, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return false, nil
	}
	return strconv.ParseBool(raw)
}
func env(key, fallback string) string {
	if s := os.Getenv(key); s != "" {
		return s
	}
	return fallback
}

type contextTransport struct {
	ctx  context.Context
	base http.RoundTripper
}

func (t contextTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.base.RoundTrip(req.Clone(t.ctx))
}

func (c *Client) check(ctx context.Context, action, service string, params map[string]string) error {
	if c == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	client, err := sdk.NewClientWithAccessKey(c.Region, c.AccessKeyID, c.AccessKeySecret)
	if err != nil {
		return ErrUnavailable
	}
	base := c.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	client.SetTransport(contextTransport{ctx: ctx, base: base})
	client.SetConnectTimeout(time.Second)
	client.SetReadTimeout(2500 * time.Millisecond)
	req := requests.NewCommonRequest()
	req.Method = "POST"
	req.Scheme = "https"
	req.Domain = "green-cip." + c.Region + ".aliyuncs.com"
	req.Version = "2022-03-02"
	req.ApiName = action
	payload, _ := json.Marshal(params)
	req.FormParams["Service"] = service
	req.FormParams["ServiceParameters"] = string(payload)
	resp, err := client.ProcessCommonRequest(req)
	if err != nil || resp.GetHttpStatus() != http.StatusOK {
		return ErrUnavailable
	}
	var result struct {
		Code int `json:"Code"`
		Data struct {
			RiskLevel string `json:"RiskLevel"`
		} `json:"Data"`
	}
	if json.Unmarshal(resp.GetHttpContentBytes(), &result) != nil || result.Code != 200 {
		return ErrUnavailable
	}
	switch result.Data.RiskLevel {
	case "none":
		return nil
	case "low", "medium", "high":
		return ErrRejected
	default:
		return ErrUnavailable
	}
}

func (c *Client) CheckText(ctx context.Context, text string) error {
	if c == nil || strings.TrimSpace(text) == "" {
		return nil
	}
	// 按增强版单次文本上限分段，任何一段未通过都不发布。
	chars := []rune(text)
	for len(chars) > 0 {
		end := len(chars)
		if end > 600 {
			end = 600
		}
		if err := c.check(ctx, "TextModerationPlus", c.TextService, map[string]string{"content": string(chars[:end])}); err != nil {
			return err
		}
		chars = chars[end:]
	}
	return nil
}

func (c *Client) CheckImages(ctx context.Context, urls []string) error {
	if c == nil {
		return nil
	}
	seen := map[string]bool{}
	for _, raw := range urls {
		if seen[raw] {
			continue
		}
		seen[raw] = true
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return ErrUnavailable
		}
		if err = c.check(ctx, "ImageModeration", c.ImageService, map[string]string{"imageUrl": raw}); err != nil {
			return err
		}
	}
	return nil
}

// OpenIM 3.8 的 content 常为 JSON 字符串，嵌套字段兼容原生 PascalCase。
func (c *Client) CheckMessage(ctx context.Context, kind int, raw json.RawMessage) error {
	if c == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3500*time.Millisecond)
	defer cancel()
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ErrUnavailable
	}
	if str, ok := value.(string); ok {
		if json.Unmarshal([]byte(str), &value) != nil {
			return ErrUnavailable
		}
	}
	var texts, images []string
	var walk func(any, string, int, int) error
	walk = func(v any, key string, depth, messageKind int) error {
		if depth > 16 {
			return ErrUnavailable
		}
		switch node := v.(type) {
		case map[string]any:
			for k, child := range node {
				if strings.EqualFold(k, "contentType") {
					if n, ok := child.(float64); ok {
						messageKind = int(n)
					}
				}
			}
			keys := make([]string, 0, len(node))
			for k := range node {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				childKind := messageKind
				if strings.EqualFold(k, "pictureElem") {
					childKind = 102
				}
				if strings.EqualFold(k, "videoElem") {
					childKind = 104
				}
				if err := walk(node[k], strings.ToLower(k), depth+1, childKind); err != nil {
					return err
				}
			}
		case []any:
			for _, child := range node {
				if err := walk(child, key, depth+1, messageKind); err != nil {
					return err
				}
			}
		case string:
			if key == "multimessage" || key == "quotemessage" || (key == "content" && messageKind != 101) {
				var nested any
				if json.Unmarshal([]byte(node), &nested) == nil {
					switch nested.(type) {
					case map[string]any, []any:
						// 原文仍须审核，避免普通文本恰好为 JSON 时绕过。
						if key == "content" {
							texts = append(texts, node)
						}
						return walk(nested, "", depth+1, messageKind)
					}
				}
			}
			if key == "text" || key == "content" {
				texts = append(texts, node)
			}
			if ((key == "url" || key == "sourceurl") && messageKind == 102) || (key == "snapshoturl" && messageKind == 104) {
				images = append(images, node)
			}
		}
		return nil
	}
	if err := walk(value, "", 0, kind); err != nil {
		return err
	}
	switch kind {
	case 101, 106, 114, 117:
		if len(texts) == 0 {
			return ErrUnavailable
		}
		if err := c.CheckText(ctx, strings.Join(texts, "\n")); err != nil {
			return err
		}
		return c.CheckImages(ctx, images)
	case 107:
		if len(texts) == 0 && len(images) == 0 {
			return ErrUnavailable
		}
		if err := c.CheckText(ctx, strings.Join(texts, "\n")); err != nil {
			return err
		}
		return c.CheckImages(ctx, images)
	case 102:
		if len(images) == 0 {
			return ErrUnavailable
		}
		return c.CheckImages(ctx, images)
	case 104:
		// 视频暂只检查封面，完整视频/语音机审须另配异步审核通道。
		return c.CheckImages(ctx, images)
	default:
		return nil
	}
}
