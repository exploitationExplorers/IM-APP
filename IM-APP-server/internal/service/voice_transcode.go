package service

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// voiceTranscodeTimeout 单条语音转码超时。语音很短（几十 KB），20s 绰绰有余。
const voiceTranscodeTimeout = 20 * time.Second

// TranscodeVoiceToM4A 把浏览器录制的音频（主要是 Chrome 的 opus-in-webm）转成
// AAC-in-MP4（m4a），让 iOS AVPlayer / 安卓 / H5 三端系统播放器都能直接播。
//
// 为什么必须服务端转：iOS 的 AVPlayer 不支持 opus-in-webm，而浏览器 MediaRecorder
// 没有 AAC 编码器，录制侧无法自救；App 侧也没有 ffmpeg。
//
// ffmpeg 未安装或转码失败时返回错误，由调用方降级为「原样存储」，保证不比现状更差。
func TranscodeVoiceToM4A(in []byte, srcExt string) ([]byte, error) {
	if len(in) == 0 {
		return nil, fmt.Errorf("输入为空")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, fmt.Errorf("ffmpeg 不可用: %w", err)
	}

	dir, err := os.MkdirTemp("", "voice-tc")
	if err != nil {
		return nil, fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(dir)

	// 用临时文件而不是 pipe：MP4 复用器对不可 seek 的输出会直接失败。
	ext := strings.TrimPrefix(strings.ToLower(srcExt), ".")
	if ext == "" {
		ext = "bin"
	}
	inPath := filepath.Join(dir, "input."+ext)
	outPath := filepath.Join(dir, "output.m4a")
	if err := os.WriteFile(inPath, in, 0o600); err != nil {
		return nil, fmt.Errorf("写入临时文件失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), voiceTranscodeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", inPath,
		"-vn",                 // 只要音频轨
		"-c:a", "aac",         // AAC-LC
		"-b:a", "24k",         // 语音 24kbps 足够
		"-ac", "1",            // 单声道
		"-movflags", "+faststart",
		outPath,
	)
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("ffmpeg 转码失败: %w %s", err, msg)
	}
	out, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("读取转码结果失败: %w", err)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("ffmpeg 输出为空")
	}
	return out, nil
}
