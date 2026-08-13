const KEEP_STORAGE_KEYS = ['im_token', 'im_refresh_token', 'im_device_id']

export function clearAppCache(): void {
  const info = uni.getStorageInfoSync()
  for (const key of info.keys) {
    if (!KEEP_STORAGE_KEYS.includes(key)) {
      uni.removeStorageSync(key)
    }
  }

  // #ifdef APP-PLUS
  try {
    const plusObj = (globalThis as { plus?: { cache?: { clear?: (cb?: () => void) => void } } }).plus
    plusObj?.cache?.clear?.()
  } catch {
  }
  // #endif
}
