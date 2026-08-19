let iosApp: boolean | null = null

/**
 * iOS App 端专项能力限制（如一次最多转发 99 条消息）。
 * 条件编译限定在 App 平台：H5 / 小程序不受苹果侧约束，恒为 false。
 * 模块级缓存，避免高频调用（多选勾选）反复同步读系统信息。
 */
export function isIOSApp(): boolean {
  if (iosApp !== null) return iosApp
  iosApp = false
  // #ifdef APP-PLUS
  try {
    iosApp = uni.getSystemInfoSync().platform === 'ios'
  } catch {
    // 取不到系统信息时按非 iOS 处理，不施加限制
  }
  // #endif
  return iosApp
}
