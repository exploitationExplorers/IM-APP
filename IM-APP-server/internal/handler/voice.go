package handler

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"im-app-server/internal/infra"
	"im-app-server/internal/middleware"
	"im-app-server/internal/response"
	"im-app-server/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// maxVoiceBytes H5 语音最大 10MB（正常一条几十 KB）
const maxVoiceBytes = 10 << 20

type VoiceHandler struct {
	Storage *infra.Storage
}

// UploadVoice 接收网页端录制的语音，需要时转码成 m4a(AAC) 再落 MinIO。
//
// 背景：H5 的 MediaRecorder 在 Chrome/安卓上只能录 opus-in-webm，iOS AVPlayer 不支持；
// 浏览器侧又没有 AAC 编码器，只能在服务端转。转码失败（含未安装 ffmpeg）时降级原样存储。
func (h *VoiceHandler) UploadVoice(c *gin.Context) {
	if !h.Storage.Available() {
		response.Fail(c, http.StatusServiceUnavailable, "文件服务未配置")
		return
	}
	f, err := c.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "缺少语音文件")
		return
	}
	if f.Size > maxVoiceBytes {
		response.Fail(c, http.StatusRequestEntityTooLarge, "语音文件过大")
		return
	}
	src, err := f.Open()
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "读取语音失败")
		return
	}
	defer src.Close()
	raw, err := io.ReadAll(io.LimitReader(src, maxVoiceBytes))
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "读取语音失败")
		return
	}
	if len(raw) == 0 {
		response.Fail(c, http.StatusBadRequest, "语音内容为空")
		return
	}

	ext := extOfVoice(f.Filename, f.Header.Get("Content-Type"))
	data := raw
	outExt := strings.TrimPrefix(ext, ".")
	if voiceNeedsTranscode(ext, raw) {
		if out, terr := service.TranscodeVoiceToM4A(raw, strings.TrimPrefix(ext, ".")); terr == nil && len(out) > 0 {
			data = out
			outExt = "m4a"
		}
	}
	if outExt == "" {
		outExt = "m4a"
	}

	userID := middleware.UserID(c)
	objectKey := fmt.Sprintf("voices/%s/%s.%s", userID, uuid.NewString(), outExt)
	store := h.Storage.Current
	objectKey, err = store.NewKey(objectKey)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "语音文件名无效")
		return
	}
	if err := store.PutObject(c.Request.Context(), objectKey, bytes.NewReader(data), int64(len(data)), audioContentType(outExt)); err != nil {
		response.Fail(c, http.StatusInternalServerError, "保存语音失败")
		return
	}
	response.OK(c, gin.H{
		"url":    store.FileURL(objectKey),
		"size":   len(data),
		"format": outExt,
	})
}

/** 扩展名：优先取文件名后缀，缺失时按 Content-Type 推断。 */
func extOfVoice(fileName, contentType string) string {
	if ext := strings.ToLower(path.Ext(fileName)); ext != "" {
		return ext
	}
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "webm"):
		return ".webm"
	case strings.Contains(ct, "ogg"), strings.Contains(ct, "opus"):
		return ".ogg"
	case strings.Contains(ct, "mp4"), strings.Contains(ct, "m4a"):
		return ".m4a"
	case strings.Contains(ct, "aac"):
		return ".aac"
	case strings.Contains(ct, "mpeg"):
		return ".mp3"
	case strings.Contains(ct, "wav"):
		return ".wav"
	}
	return ""
}

/** iOS AVPlayer 不支持 opus-in-webm；wav/amr 体积大也一并转；mp3/m4a/aac 已是通用格式，原样存。 */
func voiceNeedsTranscode(ext string, head []byte) bool {
	switch strings.TrimPrefix(strings.ToLower(ext), ".") {
	case "webm", "ogg", "oga", "opus", "amr", "3gp", "3gpp", "wav":
		return true
	}
	// 无扩展名时按文件头判断：EBML(webm/matroska) / OggS / RIFF(wav)
	if len(head) >= 4 {
		if head[0] == 0x1a && head[1] == 0x45 && head[2] == 0xdf && head[3] == 0xa3 {
			return true
		}
		if string(head[:4]) == "OggS" || string(head[:4]) == "RIFF" {
			return true
		}
	}
	return false
}

func audioContentType(ext string) string {
	switch ext {
	case "aac":
		return "audio/aac"
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "amr":
		return "audio/amr"
	case "webm":
		return "audio/webm"
	case "ogg":
		return "audio/ogg"
	}
	return "audio/mp4"
}
