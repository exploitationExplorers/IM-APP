import { APP_CONFIG } from '@/config'
import { getToken } from '@/utils/request'

export interface VoiceUploadResult {
  url: string
  size: number
  format?: string
}

/**
 * 网页端语音上传：走业务后端 POST /files/voice，由后端统一转码成 m4a(AAC)。
 *
 * 为什么不能像 App 那样直接用 OpenIM 的 UploadFile：
 * Chrome/安卓浏览器的 MediaRecorder 只能录 opus-in-webm，iOS 的 AVPlayer 不支持，
 * 而浏览器侧又没有 AAC 编码器，只能在服务端转。转码失败时后端会原样存储，不会更差。
 *
 * 仅 H5 使用：App 端录音本来就是 aac/m4a，不需要转码。
 */
export async function uploadVoiceViaApi(blob: Blob, fileName: string): Promise<VoiceUploadResult> {
  const form = new FormData()
  form.append('file', blob, fileName)
  const token = getToken()
  const res = await fetch(`${APP_CONFIG.apiBaseUrl}/files/voice`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  if (!res.ok) throw new Error(`语音上传失败(${res.status})`)
  const json = (await res.json()) as Partial<VoiceUploadResult> & {
    data?: VoiceUploadResult
    msg?: string
  }
  const data = json.data || json
  if (!data?.url) throw new Error(json.msg || '语音上传失败')
  return { url: data.url, size: Number(data.size || 0), format: data.format }
}
