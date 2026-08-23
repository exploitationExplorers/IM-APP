/** 仅开发环境输出，正式 H5 / App 包不会打印 */
export function devLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log(...args)
}

export function devWarn(...args: unknown[]) {
  if (import.meta.env.DEV) console.warn(...args)
}
