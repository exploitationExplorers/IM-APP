import { APP_CONFIG } from '@/config'
import { isAppPlatform } from '@/utils/platform'

export function canOpenAppStore(): boolean {
  return APP_CONFIG.appStore && /^\d+$/.test(APP_CONFIG.appStoreId) && isAppPlatform()
}

export function openAppStore(): void {
  if (!canOpenAppStore() || typeof plus === 'undefined') return
  plus.runtime?.openURL?.(`https://apps.apple.com/app/id${APP_CONFIG.appStoreId}`)
}

export function readLocalVersionName(): string {
  const runtime = typeof plus === 'undefined' ? undefined : plus.runtime
  return runtime?.version || uni.getSystemInfoSync().appVersion || APP_CONFIG.version
}
