import { reactive } from 'vue'

export interface ImConfirmOptions {
  title: string
  content?: string
  cancelText?: string
  confirmText?: string
  showCancel?: boolean
}

const dialogState = reactive({
  visible: false,
  title: '',
  content: '',
  cancelText: '取消',
  confirmText: '确认',
  showCancel: true,
})

let pendingResolve: ((value: boolean) => void) | null = null

/** 命令式确认弹窗，用法类似 uni.showModal，返回是否点击确认 */
export function imConfirm(options: ImConfirmOptions): Promise<boolean> {
  if (pendingResolve) {
    pendingResolve(false)
    pendingResolve = null
  }
  dialogState.title = options.title
  dialogState.content = options.content ?? options.title
  dialogState.cancelText = options.cancelText ?? '取消'
  dialogState.confirmText = options.confirmText ?? '确认'
  dialogState.showCancel = options.showCancel !== false
  dialogState.visible = true
  return new Promise((resolve) => {
    pendingResolve = resolve
  })
}

function finish(confirmed: boolean) {
  if (!pendingResolve) return
  dialogState.visible = false
  const resolve = pendingResolve
  pendingResolve = null
  resolve(confirmed)
}

/** 供 ImConfirmDialogHost 绑定全局单例状态 */
export function useImConfirmDialog() {
  return {
    state: dialogState,
    onConfirm: () => finish(true),
    onCancel: () => finish(false),
  }
}
