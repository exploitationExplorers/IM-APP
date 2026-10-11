import { ACTIVE_TAB_KEY, AUTH_SLOTS_KEY } from '@/utils/request'
import { LOGIN_REMEMBER_KEYS } from '@/utils/login-phone'

const DEVICE_ID_KEY = 'im_device_id'

function clearNativeWebCache() {
  // #ifdef APP-PLUS
  try {
    const plusObj = (globalThis as { plus?: { cache?: { clear?: (cb?: () => void) => void } } }).plus
    plusObj?.cache?.clear?.()
  } catch {
    /* ignore */
  }
  // #endif
}

/** 设置页「清除缓存」：保留登录态与设备 ID */
export function clearAppCache(): void {
  const keep = new Set([
    'im_token',
    'im_refresh_token',
    AUTH_SLOTS_KEY,
    ACTIVE_TAB_KEY,
    DEVICE_ID_KEY,
    ...LOGIN_REMEMBER_KEYS,
  ])
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!keep.has(key)) {
      uni.removeStorageSync(key)
    }
  }
  clearNativeWebCache()
}

/** 退出登录：清本页业务缓存。其它标签页的登录态留在 im_auth_slots 里。 */
export function clearSessionStorage(): void {
  const keep = new Set([DEVICE_ID_KEY, AUTH_SLOTS_KEY, ...LOGIN_REMEMBER_KEYS])
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!keep.has(key)) {
      uni.removeStorageSync(key)
    }
  }
  clearNativeWebCache()
}
