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
  const keep = new Set(['im_token', 'im_refresh_token', DEVICE_ID_KEY])
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!keep.has(key)) {
      uni.removeStorageSync(key)
    }
  }
  clearNativeWebCache()
}

/** 退出登录：清业务缓存与原生 WebView 缓存，仅保留设备 ID */
export function clearSessionStorage(): void {
  const keep = new Set([DEVICE_ID_KEY])
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!keep.has(key)) {
      uni.removeStorageSync(key)
    }
  }
  clearNativeWebCache()
}
