import { ACTIVE_TAB_KEY, AUTH_SLOTS_KEY } from '@/utils/request'
import { LOGIN_REMEMBER_KEYS } from '@/utils/login-phone'
import { clearPreviewImageCache } from '@/utils/previewImageCache'
import { PREVIEW_IMAGE_INDEX_KEY } from '@/utils/previewImageStorage'
import { isRetentionStorageKey } from '@/utils/groupRetention'

const DEVICE_ID_KEY = 'im_device_id'
/** 聊天偏好（回车发送等）：登出/清缓存都保留，否则每次登录都要重开开关 */
const CHAT_SETTINGS_KEY = 'im_chat_settings_v1'
const CHAT_SETTINGS_JSON_KEY = 'im_chat_settings_v1_json'

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
  void clearPreviewImageCache().catch(() => undefined)
  const keep = new Set([
    PREVIEW_IMAGE_INDEX_KEY, // Removed by the async cache clearer after in-flight writes settle.
    'im_token',
    'im_refresh_token',
    AUTH_SLOTS_KEY,
    ACTIVE_TAB_KEY,
    DEVICE_ID_KEY,
    CHAT_SETTINGS_KEY,
    CHAT_SETTINGS_JSON_KEY,
    ...LOGIN_REMEMBER_KEYS,
  ])
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!keep.has(key) && !isRetentionStorageKey(key)) {
      uni.removeStorageSync(key)
    }
  }
  clearNativeWebCache()
}

/** 退出登录：清本页业务缓存。其它标签页的登录态留在 im_auth_slots 里。 */
export function clearSessionStorage(): void {
  void clearPreviewImageCache().catch(() => undefined)
  const keep = new Set([
    PREVIEW_IMAGE_INDEX_KEY,
    DEVICE_ID_KEY,
    AUTH_SLOTS_KEY,
    CHAT_SETTINGS_KEY,
    CHAT_SETTINGS_JSON_KEY,
    ...LOGIN_REMEMBER_KEYS,
  ])
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!keep.has(key) && !isRetentionStorageKey(key)) {
      uni.removeStorageSync(key)
    }
  }
  clearNativeWebCache()
}
