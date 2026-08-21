import { checkAppRelease } from '@/api/app-release'
import { APP_CONFIG } from '@/config'
import type { AppReleaseCheckResult, AppReleaseLocalVersion } from '@/types'

const AUTO_CHECK_INTERVAL_MS = 2 * 60 * 1000

let checking = false
let installing = false
let lastAutoCheckAt = 0

function isAppPlatform(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'app'
  } catch {
    return false
  }
}

function whenRuntimeReady(): Promise<void> {
  if (!isAppPlatform() || plus?.runtime) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => resolve()
    try {
      if (typeof document !== 'undefined') {
        document.addEventListener('plusready', done, { once: true })
      }
    } catch {
      /* App 端可能没有 document */
    }
    setTimeout(done, 2000)
  })
}

function parseVersionCode(raw: string | number | undefined, fallback = 0): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function currentPlatform(): 'android' | 'ios' {
  const info = uni.getSystemInfoSync()
  const os = `${info.osName || ''} ${info.platform || ''}`.toLowerCase()
  return os.includes('ios') ? 'ios' : 'android'
}

export async function readLocalAppVersion(): Promise<AppReleaseLocalVersion> {
  await whenRuntimeReady()
  const platform = currentPlatform()
  const sys = uni.getSystemInfoSync() as UniApp.GetSystemInfoResult & {
    appWgtVersion?: string
    appVersion?: string
    appVersionCode?: string | number
  }
  const fallbackName = sys.appWgtVersion || sys.appVersion || APP_CONFIG.version
  const fallbackNative = parseVersionCode(sys.appVersionCode)
  const fallbackWgt = parseVersionCode(sys.appWgtVersion, fallbackNative)

  return new Promise((resolve) => {
    const runtime = plus?.runtime
    if (!runtime?.getProperty || !runtime.appid) {
      resolve({
        platform,
        nativeVersion: fallbackNative,
        wgtVersion: fallbackWgt,
        versionName: String(fallbackName),
      })
      return
    }
    runtime.getProperty(runtime.appid, (widget) => {
      resolve({
        platform,
        nativeVersion: parseVersionCode(runtime.versionCode, fallbackNative),
        wgtVersion: parseVersionCode(widget?.versionCode, fallbackWgt),
        versionName: String(widget?.version || fallbackName),
      })
    })
  })
}

function confirmUpdate(release: AppReleaseCheckResult): Promise<boolean> {
  const title = release.updateType === 'native' ? '需要更新安装包' : '发现新版本'
  const versionLabel = release.versionName ? `v${release.versionName.replace(/^v/i, '')}` : ''
  const changelog = (release.changelog || '').trim() || '修复若干问题，建议立即更新。'
  const content = [versionLabel, changelog].filter(Boolean).join('\n')
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      showCancel: !release.forceUpdate,
      cancelText: '稍后',
      confirmText: release.updateType === 'native' ? '下载安装包' : '立即更新',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
}

function installPackage(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const runtime = plus?.runtime
    if (!runtime?.install) {
      reject(new Error('当前环境不支持热更新'))
      return
    }
    runtime.install(
      filePath,
      { force: true },
      () => {
        runtime.restart()
        resolve()
      },
      (err) => reject(err instanceof Error ? err : new Error('安装更新失败')),
    )
  })
}

function downloadAndApply(release: AppReleaseCheckResult): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.showLoading({ title: '正在下载更新...', mask: true })
    const task = uni.downloadFile({
      url: release.downloadUrl,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          uni.hideLoading()
          reject(new Error('下载更新失败'))
          return
        }
        uni.showLoading({ title: '正在安装...', mask: true })
        void installPackage(res.tempFilePath)
          .then(resolve)
          .catch(reject)
          .finally(() => uni.hideLoading())
      },
      fail: () => {
        uni.hideLoading()
        reject(new Error('下载更新失败'))
      },
    })
    task.onProgressUpdate?.((p) => {
      const percent = Math.max(0, Math.min(100, p.progress || 0))
      uni.showLoading({ title: `正在下载 ${percent}%`, mask: true })
    })
  })
}

async function applyRelease(release: AppReleaseCheckResult): Promise<void> {
  if (installing) return
  installing = true
  try {
    if (release.updateType === 'native') {
      const platform = currentPlatform()
      if (platform === 'ios') {
        plus?.runtime?.openURL(release.downloadUrl)
        return
      }
    }
    await downloadAndApply(release)
  } finally {
    installing = false
  }
}

export async function checkAndPromptAppUpdate(options: { manual?: boolean } = {}): Promise<boolean> {
  if (!isAppPlatform() || checking || installing) {
    if (!isAppPlatform() && options.manual) {
      uni.showToast({ title: '请在 App 内检查更新', icon: 'none' })
    }
    return false
  }
  if (!options.manual && Date.now() - lastAutoCheckAt < AUTO_CHECK_INTERVAL_MS) {
    return false
  }
  checking = true
  lastAutoCheckAt = Date.now()
  try {
    const local = await readLocalAppVersion()
    const release = await checkAppRelease({
      platform: local.platform,
      channel: APP_CONFIG.updateChannel,
      nativeVersion: local.nativeVersion,
      wgtVersion: local.wgtVersion,
    })
    if (!release?.hasUpdate || release.updateType === 'none' || !release.downloadUrl) {
      if (options.manual) {
        uni.showToast({ title: '已是最新版本', icon: 'none' })
      }
      return false
    }
    const confirmed = await confirmUpdate(release)
    if (!confirmed) return false
    await applyRelease(release)
    return true
  } catch (err) {
    if (options.manual) {
      uni.showToast({
        title: err instanceof Error ? err.message : '检查更新失败',
        icon: 'none',
      })
    }
    return false
  } finally {
    checking = false
  }
}
