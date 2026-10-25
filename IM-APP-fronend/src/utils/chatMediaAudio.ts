import type { PlusFileEntry, PlusResolveLocalFile } from '@/types/plus-io'
import { downloadRemoteFile } from '@/utils/chatMediaDownload'
import {
  isRemoteMediaUrl,
  looksLikeLocalFilePath,
  playableMediaUrl,
} from '@/utils/chatMediaUrl'
import { isAppPlatform, isIOSApp } from '@/utils/platform'

const AUDIO_EXT_RE = /\.(aac|m4a|mp3|wav|caf|amr)(\?|#|$)/i

type PlusFileReader = {
  onloadend: ((e: { target?: { result?: unknown } }) => void) | null
  onerror: (() => void) | null
  readAsDataURL: (file: unknown) => void
}
type PlusIo = {
  resolveLocalFileSystemURL?: PlusResolveLocalFile
  FileReader?: new () => PlusFileReader
}

/**
 * 异步把 App 本地相对路径解析成 AVPlayer 能打开的绝对 file:// 路径。
 * 优先同步接口；自定义基座常缺这两个方法，回退 resolveLocalFileSystemURL。
 */
async function resolveAbsAudioPath(rel: string): Promise<string> {
  const clean = (rel || '').trim()
  if (!clean || clean.startsWith('file://') || isRemoteMediaUrl(clean) || clean.startsWith('blob:')) {
    return clean
  }
  const io = plus?.io as
    | {
        convertToAbsURL?: (u: string) => string
        convertLocalFileSystemURL?: (u: string) => string
        resolveLocalFileSystemURL?: PlusResolveLocalFile
      }
    | undefined

  const syncConvert = io?.convertToAbsURL || io?.convertLocalFileSystemURL
  if (typeof syncConvert === 'function') {
    try {
      const abs = syncConvert(clean)
      if (abs) return abs.startsWith('file://') ? abs : `file://${abs}`
    } catch {
      /* 旧基座转换异常，走异步兜底 */
    }
  }

  if (typeof io?.resolveLocalFileSystemURL === 'function') {
    try {
      const abs = await new Promise<string>((resolve, reject) => {
        io!.resolveLocalFileSystemURL!(
          clean,
          (entry: { toURL?: () => string; toLocalURL?: () => string; fullPath?: string }) => {
            const u = entry.toURL?.() || entry.toLocalURL?.() || entry.fullPath || ''
            if (u) resolve(u.startsWith('file://') || isRemoteMediaUrl(u) ? u : `file://${u}`)
            else reject(new Error('无法解析语音路径'))
          },
          (err: unknown) => reject(new Error(typeof err === 'string' ? err : JSON.stringify(err))),
        )
      })
      if (abs) return abs
    } catch {
      /* 落到原值 */
    }
  }
  return clean
}

/** 读文件头若干字节；读不到返回 null（不影响后续按后缀兜底） */
function readFileHead(path: string, size = 16): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const io = plus?.io as unknown as PlusIo | undefined
    const Reader = io?.FileReader
    if (!io?.resolveLocalFileSystemURL || !Reader) {
      resolve(null)
      return
    }
    io.resolveLocalFileSystemURL(
      path,
      (entry: { file?: PlusFileEntry['file'] }) => {
        if (!entry.file) {
          resolve(null)
          return
        }
        entry.file(
          (file: { slice?: (start: number, end: number) => unknown }) => {
            const reader = new Reader()
            reader.onloadend = (e) => {
              const result = String(e.target?.result || '')
              const base64 = result.slice(result.indexOf(',') + 1)
              try {
                resolve(base64 ? new Uint8Array(uni.base64ToArrayBuffer(base64)).slice(0, size) : null)
              } catch {
                resolve(null)
              }
            }
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(typeof file.slice === 'function' ? file.slice(0, size) : file)
          },
          () => resolve(null),
        )
      },
      () => resolve(null),
    )
  })
}

/** 确认本地语音文件存在（带超时） */
function fileExistsForPlay(absPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const io = plus?.io as unknown as { resolveLocalFileSystemURL?: PlusResolveLocalFile } | undefined
    if (!io?.resolveLocalFileSystemURL) {
      resolve(true)
      return
    }
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve(true)
      }
    }, 2500)
    try {
      io.resolveLocalFileSystemURL(
        absPath,
        () => {
          if (!done) {
            done = true
            clearTimeout(timer)
            resolve(true)
          }
        },
        () => {
          if (!done) {
            done = true
            clearTimeout(timer)
            resolve(false)
          }
        },
      )
    } catch {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(true)
      }
    }
  })
}

/**
 * 按文件头判断真实封装。iOS AVPlayer 依赖后缀选解析器：
 * 安卓录的 ADTS-AAC 被改名成 .m4a 会直接 MediaError，必须用和内容一致的后缀。
 */
function sniffAudioExt(h: Uint8Array): string {
  if (h.length < 4) return ''
  const ascii = (start: number, end: number) => String.fromCharCode(...Array.from(h.slice(start, end)))
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return 'aac'
  if (ascii(4, 8) === 'ftyp') return 'm4a'
  if (ascii(0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return 'mp3'
  if (ascii(0, 4) === 'RIFF') return 'wav'
  if (ascii(0, 4) === 'caff') return 'caf'
  if (ascii(0, 5) === '#!AMR') return 'amr'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return 'webm'
  return ''
}

/**
 * 下载结果经常没有后缀，系统不知道用哪个应用打开。
 * 拷到应用目录并带上原始文件名后再交给播放器 / openDocument。
 */
export function persistNamedFile(tempPath: string, fileName: string): Promise<string> {
  return new Promise((resolve) => {
    const io = plus?.io as { resolveLocalFileSystemURL?: PlusResolveLocalFile } | undefined
    if (!io?.resolveLocalFileSystemURL) {
      resolve(tempPath)
      return
    }
    const safe = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(-100) || 'file'
    const src = /^(file|content):\/\//.test(tempPath) ? tempPath : tempPath
    io.resolveLocalFileSystemURL(
      src,
      (entry: { copyTo?: PlusFileEntry['copyTo'] }) => {
        io.resolveLocalFileSystemURL?.(
          '_doc/',
          (dir: object) => {
            if (!entry.copyTo) {
              resolve(tempPath)
              return
            }
            entry.copyTo(
              dir,
              `${Date.now()}_${safe}`,
              (copied: { fullPath?: string; toLocalURL?: () => string }) => {
                resolve(copied.fullPath || copied.toLocalURL?.() || tempPath)
              },
              () => resolve(tempPath),
            )
          },
          () => resolve(tempPath),
        )
      },
      () => resolve(tempPath),
    )
  })
}

const playableAudioCache = new Map<string, string>()

async function toNamedPlayableAudio(localPath: string, srcHint = ''): Promise<string> {
  const head = await readFileHead(localPath)
  const ext = head ? sniffAudioExt(head) : ''
  if ((ext === 'webm' || ext === 'ogg') && isIOSApp()) {
    throw new Error('该语音为网页端录制的格式，iOS 暂不支持播放')
  }
  if (!ext) {
    if (AUDIO_EXT_RE.test(localPath)) return localPath
    // 读不到文件头时按来源地址后缀兜底；语音几乎都是 aac/m4a，缺省 .aac。
    // 切勿盲给 .m4a：裸 ADTS-AAC 被当 MP4 容器解析会 MediaError。
    const m = srcHint.match(/\.(aac|m4a|mp3|wav|caf|amr)(\?|#|$)/i)
    const fallbackExt = (m && m[1] ? m[1] : 'aac').toLowerCase()
    return persistNamedFile(localPath, `voice_${Date.now()}.${fallbackExt}`)
  }
  if (new RegExp(`\\.${ext}(\\?|#|$)`, 'i').test(localPath)) return localPath
  return persistNamedFile(localPath, `voice_${Date.now()}.${ext}`)
}

/**
 * App 上远程语音先完整下载到本地，再按文件头/来源后缀补真实封装后交给 InnerAudio；
 * 同一条语音只落地一次。H5 仍走原 URL。
 */
export async function ensurePlayableAudioPath(url: string): Promise<string> {
  const original = (url || '').trim()
  const src = playableMediaUrl(original)
  if (!src) return ''
  if (!isAppPlatform()) return src

  if (/\.(webm|ogg|opus)(\?|#|$)/i.test(src)) {
    const msg = isIOSApp()
      ? '该语音为网页端录制的格式，iOS 暂不支持播放'
      : '该语音格式暂不支持播放'
    throw new Error(msg)
  }

  const cached = playableAudioCache.get(original)
  if (cached) return cached

  let local = src
  if (isRemoteMediaUrl(src)) {
    try {
      local = await downloadRemoteFile(src)
    } catch {
      local = src
    }
  } else if (
    looksLikeLocalFilePath(original) ||
    original.startsWith('_doc') ||
    original.startsWith('_www') ||
    original.startsWith('_downloads')
  ) {
    const abs = await resolveAbsAudioPath(original)
    const ok = await fileExistsForPlay(abs)
    if (!ok) throw new Error('语音文件已过期，请让对方重新发送')
    local = abs
  }

  // uni.downloadFile 在 iOS 上返回的 tempFilePath 常是相对路径，需绝对化
  if (!isRemoteMediaUrl(local) && !local.startsWith('file://') && looksLikeLocalFilePath(local)) {
    const abs = await resolveAbsAudioPath(local)
    if (abs && abs !== local) local = abs
  }
  const playable = await toNamedPlayableAudio(local, src)
  if (playableAudioCache.size > 200) playableAudioCache.clear()
  playableAudioCache.set(original, playable)
  return playable
}
