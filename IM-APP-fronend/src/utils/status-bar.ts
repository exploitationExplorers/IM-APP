/** App 端 navigationStyle:custom 时页面从屏幕顶端绘制，需让出系统状态栏；H5 为 0 */
export function getStatusBarHeight(): number {
  return uni.getSystemInfoSync().statusBarHeight || 0
}
