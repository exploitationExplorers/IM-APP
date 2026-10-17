/**
 * 运行端判断只留这一处。系统信息懒读一次并缓存，
 * 避免各文件各自调 getSystemInfoSync。
 */

type SystemSnapshot = {
  uniPlatform: string
  osName: string
  platform: string
}

let snapshot: SystemSnapshot | null = null

function readSystem(): SystemSnapshot {
  if (snapshot) return snapshot
  try {
    const info = uni.getSystemInfoSync()
    snapshot = {
      uniPlatform: String(info.uniPlatform || ''),
      osName: String(info.osName || ''),
      platform: String(info.platform || ''),
    }
  } catch {
    snapshot = { uniPlatform: '', osName: '', platform: '' }
  }
  return snapshot
}

function osText(): string {
  const info = readSystem()
  return `${info.osName} ${info.platform}`.toLowerCase()
}

/** App 原生（含 Android / iOS / 鸿蒙自定义基座） */
export function isApp(): boolean {
  return readSystem().uniPlatform === 'app'
}

/** 历史调用名。新代码用 isApp。 */
export function isAppPlatform(): boolean {
  return isApp()
}

export function isH5(): boolean {
  const platform = readSystem().uniPlatform
  return platform === 'web' || platform === 'h5'
}

export function isIOS(): boolean {
  return osText().includes('ios')
}

export function isAndroid(): boolean {
  return osText().includes('android')
}

export function isHarmony(): boolean {
  const info = readSystem()
  return `${info.osName} ${info.platform} ${info.uniPlatform}`.toLowerCase().includes('harmony')
}

let iosApp: boolean | null = null

/**
 * iOS App 端专项能力限制（如一次最多转发 99 条消息）。
 * 条件编译限定在 App 平台：H5 / 小程序不受苹果侧约束，恒为 false。
 */
export function isIOSApp(): boolean {
  if (iosApp !== null) return iosApp
  iosApp = false
  // #ifdef APP-PLUS
  iosApp = isApp() && isIOS()
  // #endif
  return iosApp
}
