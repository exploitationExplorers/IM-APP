import { devWarn } from '@/utils/devLog'

/** 可忽略的异步失败。开发环境留日志，禁止再写空的 catch。 */
export function ignoreError(promise: Promise<unknown>, reason: string): void {
  void promise.catch((err: unknown) => {
    devWarn(reason, err)
  })
}

/** 给 .catch 用：记一笔原因后吞掉，返回值保持 undefined。 */
export function swallowError(reason: string): (err: unknown) => undefined {
  return (err: unknown) => {
    devWarn(reason, err)
    return undefined
  }
}
