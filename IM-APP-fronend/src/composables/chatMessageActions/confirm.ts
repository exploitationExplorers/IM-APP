/** uni.showModal 确认框 */
export function confirm(
  content: string,
  confirmText = '确定',
  cancelText = '取消',
): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '提示',
      content,
      confirmText,
      cancelText,
      success: (res) => resolve(!!res.confirm),
    })
  })
}
