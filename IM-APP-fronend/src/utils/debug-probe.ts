/** 调试资讯：端点探测与环境信息采集（纯前端，不新增后端接口） */

export interface ProbeResult {
  label: string
  host: string
  ms: number | null
  ok: boolean
  detail?: string
}

export interface LatencySample {
  at: number
  label: string
  ms: number
  ok: boolean
}

function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return u.port && u.port !== '80' && u.port !== '443' ? `${u.host}` : u.host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '')
  }
}

/** 从 apiBaseUrl 推出业务健康检查地址 GET /health */
export function healthUrlFromApiBase(apiBaseUrl: string): string {
  if (apiBaseUrl.startsWith('/')) {
    // H5 开发：优先同源 /health（vite 已代理）；否则用环境变量 / 线上
    if (typeof location !== 'undefined' && location.origin) {
      return `${location.origin}/health`
    }
    const envBase =
      (import.meta as ImportMeta & { env: Record<string, string> }).env?.VITE_API_BASE_URL || ''
    if (envBase.startsWith('http')) {
      return `${originOf(envBase)}/health`
    }
    return 'https://www.ke58.com/health'
  }
  return `${originOf(apiBaseUrl)}/health`
}

export function appProbeUrl(): string {
  // #ifdef H5
  if (typeof location !== 'undefined' && location.origin) {
    return location.origin + '/'
  }
  // #endif
  return 'https://www.ke58.com/'
}

export function fileProbeUrl(defaultAvatarUrl: string): string {
  try {
    const u = new URL(defaultAvatarUrl)
    return `${u.origin}/`
  } catch {
    return 'https://www.ke58.com/minio/'
  }
}

/**
 * 探测 URL 延迟。CORS/证书失败仍计时（参考站对百度等同理）。
 * 成功判定：HTTP 2xx–4xx（能连上就算通；401/404 也算网络可达）。
 */
export function probeUrl(url: string, timeoutMs = 8000): Promise<{ ms: number; ok: boolean; status?: number }> {
  const started = Date.now()
  return new Promise((resolve) => {
    uni.request({
      url,
      method: 'GET',
      timeout: timeoutMs,
      success: (res) => {
        const ms = Date.now() - started
        const status = res.statusCode || 0
        resolve({ ms, ok: status > 0 && status < 500, status })
      },
      fail: () => {
        resolve({ ms: Date.now() - started, ok: false })
      },
    })
  })
}

/** WebSocket 握手耗时（连上即关） */
export function probeWebSocket(wsUrl: string, timeoutMs = 8000): Promise<{ ms: number; ok: boolean }> {
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close({})
      } catch {
        /* ignore */
      }
      resolve({ ms: Date.now() - started, ok })
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    let socket: UniApp.SocketTask
    try {
      socket = uni.connectSocket({
        url: wsUrl,
        complete: () => undefined,
      })
    } catch {
      finish(false)
      return
    }
    socket.onOpen(() => finish(true))
    socket.onError(() => finish(false))
    socket.onClose(() => {
      if (!settled) finish(false)
    })
  })
}

export function buildProbeItem(
  label: string,
  url: string,
  result: { ms: number; ok: boolean },
): ProbeResult {
  return {
    label,
    host: hostOf(url),
    ms: result.ms,
    ok: result.ok,
  }
}

export function platformTag(): string {
  try {
    const info = uni.getSystemInfoSync()
    const uniPlatform = String(info.uniPlatform || '').toLowerCase()
    if (uniPlatform === 'web' || uniPlatform === 'h5') {
      const w = info.windowWidth || 0
      return w >= 768 ? 'D/WEB' : 'M/WEB'
    }
    if (uniPlatform === 'app' || info.platform === 'android' || info.osName === 'android') {
      return 'APP/Android'
    }
    if (info.platform === 'ios' || info.osName === 'ios') {
      return 'APP/iOS'
    }
    return String(info.uniPlatform || info.platform || 'UNK').toUpperCase()
  } catch {
    return 'UNK'
  }
}

export function browserSummary(): string {
  try {
    const info = uni.getSystemInfoSync() as UniApp.GetSystemInfoResult & {
      ua?: string
      browserName?: string
      browserVersion?: string
      osName?: string
      osVersion?: string
    }
    const os = [info.osName, info.osVersion].filter(Boolean).join(' ')
    // #ifdef H5
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent
      let browser = 'Browser'
      if (/Edg\//.test(ua)) browser = `Edge ${ua.match(/Edg\/([\d.]+)/)?.[1] || ''}`.trim()
      else if (/Chrome\//.test(ua)) browser = `Chrome ${ua.match(/Chrome\/([\d.]+)/)?.[1] || ''}`.trim()
      else if (/Safari\//.test(ua) && !/Chrome\//.test(ua))
        browser = `Safari ${ua.match(/Version\/([\d.]+)/)?.[1] || ''}`.trim()
      else if (/Firefox\//.test(ua)) browser = `Firefox ${ua.match(/Firefox\/([\d.]+)/)?.[1] || ''}`.trim()
      return [os || 'Web', browser].filter(Boolean).join(' ')
    }
    // #endif
    return [os, info.brand, info.model].filter(Boolean).join(' ') || '—'
  } catch {
    return '—'
  }
}

export async function readNetworkStatus(): Promise<string> {
  return new Promise((resolve) => {
    uni.getNetworkType({
      success: (res) => resolve(String(res.networkType || 'unknown')),
      fail: () => resolve('unknown'),
    })
  })
}

export async function readStorageUsage(): Promise<string> {
  // #ifdef H5
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      const used = est.usage || 0
      const quota = est.quota || 0
      if (quota > 0) {
        const pct = ((used / quota) * 100).toFixed(2)
        return `${pct}% (${formatBytes(used)}/${formatBytes(quota)})`
      }
      return formatBytes(used)
    }
  } catch {
    /* ignore */
  }
  // #endif
  try {
    const info = uni.getStorageInfoSync()
    const limit = typeof info.limitSize === 'number' ? info.limitSize : 0
    const current = typeof info.currentSize === 'number' ? info.currentSize : 0
    // uni 单位多为 KB
    const usedBytes = current * 1024
    const quotaBytes = limit * 1024
    if (quotaBytes > 0) {
      const pct = ((usedBytes / quotaBytes) * 100).toFixed(2)
      return `${pct}% (${formatBytes(usedBytes)}/${formatBytes(quotaBytes)})`
    }
    return formatBytes(usedBytes)
  } catch {
    return '—'
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0B'
  if (n < 1024) return `${Math.round(n)}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)}GB`
}

export function mediaSupportList(): string[] {
  const list: string[] = []
  // #ifdef H5
  try {
    if (typeof document !== 'undefined') {
      const v = document.createElement('video')
      const a = document.createElement('audio')
      const videoTypes = [
        'video/mp4; codecs="avc1.42E01E"',
        'video/mp4; codecs="opus"',
        'video/webm; codecs="vp9"',
        'video/webm; codecs="vp8"',
        'video/webm; codecs="opus"',
        'video/ogg; codecs="theora"',
        'video/mp4',
        'video/webm',
        'video/ogg',
      ]
      const audioTypes = [
        'audio/mp4; codecs="mp4a.40.2"',
        'audio/mpeg',
        'audio/mp3',
        'audio/webm; codecs="opus"',
        'audio/ogg; codecs="opus"',
        'audio/webm',
        'audio/ogg',
        'audio/mp4',
      ]
      for (const t of videoTypes) {
        const r = v.canPlayType(t)
        if (r) list.push(shortMediaLabel('v', t))
      }
      for (const t of audioTypes) {
        const r = a.canPlayType(t)
        if (r) list.push(shortMediaLabel('a', t))
      }
    }
  } catch {
    /* ignore */
  }
  // #endif
  if (!list.length) {
    list.push('平台默认解码（App 原生）')
  }
  return list
}

function shortMediaLabel(kind: 'v' | 'a', mime: string): string {
  const base = mime.split(';')[0] || mime
  const codec = mime.match(/codecs="?([^"\s]+)/i)?.[1]?.split('.')[0] || ''
  const type = base.replace(/^(video|audio)\//, '')
  return codec ? `${kind}/${type};${codec}` : `${kind}/${type}`
}

export async function capabilityFlags(): Promise<Record<string, boolean | string>> {
  const flags: Record<string, boolean | string> = {
    WS: typeof WebSocket !== 'undefined' || typeof uni.connectSocket === 'function',
    IDB: false,
    Worker: typeof Worker !== 'undefined',
    Touch: false,
    Barcode: false,
  }
  // #ifdef H5
  try {
    flags.IDB = typeof indexedDB !== 'undefined'
    flags.Touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0
    flags.Barcode = 'BarcodeDetector' in window
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      flags['sw.js'] = regs.length ? (regs[0].active?.state || 'registered') : 'none'
    } else {
      flags['sw.js'] = 'unsupported'
    }
  } catch {
    flags['sw.js'] = '—'
  }
  // #endif
  // #ifndef H5
  flags['sw.js'] = 'n/a'
  flags.IDB = false
  flags.Touch = true
  // #endif
  return flags
}

export async function permissionFlags(): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    通知: '—',
    相机: '—',
    麦克风: '—',
    储存: '—',
  }
  // #ifdef H5
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      const map: Array<[string, PermissionName]> = [
        ['通知', 'notifications' as PermissionName],
        ['相机', 'camera' as PermissionName],
        ['麦克风', 'microphone' as PermissionName],
      ]
      for (const [label, name] of map) {
        try {
          const s = await navigator.permissions.query({ name })
          out[label] = s.state
        } catch {
          out[label] = 'unsupported'
        }
      }
      try {
        const s = await navigator.permissions.query({ name: 'persistent-storage' as PermissionName })
        out['储存'] = s.state
      } catch {
        out['储存'] = '—'
      }
    }
    if (typeof Notification !== 'undefined') {
      out['通知'] = Notification.permission
    }
  } catch {
    /* ignore */
  }
  // #endif
  return out
}

export function isPrivateBrowsingGuess(): string {
  // #ifdef H5
  try {
    if (typeof indexedDB === 'undefined') return '可能'
    // Safari 私密模式粗判：打开 IDB 会失败
    return '否'
  } catch {
    return '可能'
  }
  // #endif
  return '—'
}

export { hostOf }
