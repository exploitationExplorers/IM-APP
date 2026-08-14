/**
 * 安全的页面返回。
 *
 * 问题：项目重新启动 / H5 刷新 / App 被回收后，导航栈只剩当前页，
 * 此时 uni.navigateBack() 没有上一页可退，会静默失败，表现为「点返回没反应」。
 *
 * 修复：栈内还有上一页时正常 navigateBack；否则 reLaunch 到兜底页（默认消息列表），
 * 保证任何入口都不会卡死在返回按钮上。
 */
export function safeBack(fallbackUrl = '/pages/chat/index'): void {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  if (fallbackUrl) {
    uni.reLaunch({ url: fallbackUrl })
  } else {
    uni.navigateBack()
  }
}
