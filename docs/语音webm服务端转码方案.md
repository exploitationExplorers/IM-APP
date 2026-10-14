# 网页端语音（webm/opus）在 iOS App 无法播放 —— 服务端转码方案

> 状态：方案已与用户确认（P0 服务端转码），待实施。
> 目标：网页端（Chrome/安卓浏览器）录制的语音，在 iOS App、安卓 App、H5 三端都能播。

## 1. 问题与根因

| 端 | 录音产物 | 上传通道 | iOS App 能否播 |
|---|---|---|---|
| iOS/安卓 App | aac / m4a | OpenIM SDK `CreateSoundMessageFromFullPath`（SDK 直传对象存储） | ✅ 已修复 |
| H5（Safari） | `audio/mp4`（AAC） | OpenIM SDK `UploadFile` | ✅ |
| H5（Chrome/安卓） | **`audio/webm;codecs=opus`** | OpenIM SDK `UploadFile` | ❌ |

- iOS 的 `AVPlayer` 不支持 opus-in-webm；
- 浏览器 `MediaRecorder` **没有 AAC 编码器**，录制侧无法自救；
- 上传走 **OpenIM SDK**，字节不经过业务后端（`openim.ts:2076`）；业务自己的 `/files/uploads`
  是预签名直传 MinIO（`file.go:109`），字节同样不过后端 —— 所以**转码无处落地**，必须先改上传通道。

## 2. 方案（P0）

让 H5 语音**改走业务后端**直传，后端用 ffmpeg 统一转成 `m4a`（AAC-in-MP4）再落 MinIO。

```
H5 录音(webm/mp4)
   ↓  multipart POST /api/v1/files/voice
业务后端
   ├─ 已是 mp4/m4a/aac → 原样落 MinIO
   └─ webm/ogg/opus/amr/3gp → ffmpeg → m4a(AAC) → 落 MinIO
   ↓  返回 { url, size }
H5 用 CreateSoundMessageByURL 发消息（soundType: 'm4a'）
```

为什么转 m4a 而不是 amr：AAC-in-MP4 是 iOS/安卓/H5 **三端系统播放器都原生支持**的最小公约数，
体积与 opus 同量级（约 1~2KB/s @ 24kbps 单声道），不需要引入额外解码器。

## 3. 改动清单

### 后端 `IM-APP-server`

| 文件 | 改动 |
|---|---|
| `internal/infra/minio.go` | 新增 `PutObject(ctx, objectKey, io.Reader, size, contentType) error`（复用现有 `m.Client`） |
| `internal/service/voice_transcode.go` | **新增**。`TranscodeVoiceToM4A(in []byte) ([]byte, error)`：走 `ffmpeg -i - -c:a aac -b:a 24k -ac 1 -f mp4 -`；`exec.LookPath("ffmpeg")` 缺失时返回明确错误（调用方降级为原样存储） |
| `internal/handler/voice.go` | **新增**。`UploadVoice`：multipart 单文件，限 10MB；按 Content-Type + 文件头判定是否需要转码；落 `voices/<userID>/<uuid>.m4a`；返回 `{ url, size }` |
| `cmd/server/main.go` | 在 `auth` 组加 `POST /files/voice`（与 `/files/uploads` 同组，需登录） |
| `Dockerfile` | 运行时 alpine 阶段加 `ffmpeg`（`apk add --no-cache ffmpeg`） |

### 前端 `IM-APP-fronend`

| 文件 | 改动 |
|---|---|
| `src/utils/mediaApi.ts`（新增） | `uploadVoiceViaApi(blob, fileName)`：H5 用 `fetch` + `FormData`，带 `Authorization: Bearer ${getToken()}` |
| `src/utils/openim.ts` | `sendVoiceMessage` 的 **H5 分支**：`uploadFile` → 改为 `uploadVoiceViaApi`，随后 `CreateSoundMessageByURL` 的 `soundType` 固定 `'m4a'` |

> App 分支**不动**（`CreateSoundMessageFromFullPath` 已经是 aac/m4a，且已修复可播）。

## 4. 边界与风险

1. **ffmpeg 缺失**：容器没装 ffmpeg 时，接口降级为「原样存储」，不报错 —— 保证不比现状更差。
2. **老消息无法修**：已发出的 webm 语音仍播不了。如需回刷，要另写脚本扫 MinIO + 改消息 content（本次不做）。
3. **上传变大**：H5 语音先传到业务后端再转码落 MinIO，比 SDK 直传多一跳；语音文件小（几十 KB），可接受。
4. **部署**：`Dockerfile` 改了 ffmpeg，需要**重新 build 镜像**再 `docker compose up -d`；这一步由用户执行。
5. **H5 端 CORS/鉴权**：走 `fetch` 需带 token；`APP_CONFIG.apiBaseUrl` 已是同源反代地址。

## 5. 验证步骤

1. 后端：`go build ./...` + `go vet ./...` 通过
2. 前端：`vue-tsc --noEmit` 通过（除 room.vue 3 处历史 paste 报错）
3. 部署后：Chrome 打开 H5 → 录一段语音发送 → iOS App 点播应出声
4. 回归：iOS App 自己录的语音仍能播；安卓 App 收到的 H5 语音仍能播

## 6. 发布

- 后端：用户自行 `docker compose up -d --build api`
- 前端：打 wgt 204 发布（含「调试代码清理」+ 本方案的前端改动）
