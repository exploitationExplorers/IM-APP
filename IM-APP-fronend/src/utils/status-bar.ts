/**
 * App 端 navigationStyle:custom 时页面从屏幕顶端绘制，需让出系统状态栏；H5 为 0。
 * 优先用 getWindowInfo（getSystemInfoSync 在新基座已标记废弃并打印警告）。
 */
export function getStatusBarHeight(): number {
  try {
    const win = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : null
    if (win && typeof win.statusBarHeight === 'number') return win.statusBarHeight
  } catch {
    /* 个别老基座无 getWindowInfo，回退 getSystemInfoSync */
  }
  return uni.getSystemInfoSync().statusBarHeight || 0
}
