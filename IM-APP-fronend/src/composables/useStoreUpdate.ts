import { APP_CONFIG } from '@/config'
import { isAppPlatform } from '@/utils/platform'
import type { AppReleaseLocalVersion } from '@/types'

/** 商店包不访问自建更新服务，仅由用户主动打开固定 App Store 商品页。 */
export async function checkAndPromptAppUpdate(options: { manual?: boolean } = {}): Promise<boolean> {
  if (!options.manual || !isAppPlatform()) return false
  if (!/^\d+$/.test(APP_CONFIG.appStoreId)) {
    uni.showToast({ title: '暂时无法打开 App Store，请稍后重试', icon: 'none' })
    return false
  }
  if (typeof plus === 'undefined' || !plus?.runtime?.openURL) return false
  plus.runtime.openURL(`https://apps.apple.com/app/id${APP_CONFIG.appStoreId}`)
  return true
}

export async function readLocalAppVersion(): Promise<AppReleaseLocalVersion> {
  const info = uni.getSystemInfoSync()
  const runtime = typeof plus === 'undefined' ? undefined : plus?.runtime
  return {
    platform: 'ios',
    nativeVersion: Number(runtime?.versionCode || info.appVersionCode || 0),
    wgtVersion: 0,
    versionName: runtime?.version || info.appVersion || APP_CONFIG.version,
  }
}
