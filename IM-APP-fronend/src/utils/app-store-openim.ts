/**
 * 商店包只使用 App 原生桥。枚举/类型无副作用；插件在用户同意后按需取得。
 * 保持 openim-uniapp-polyfill 1.4.5 的同步方法与异步回调协议。
 */
import { IMEvents, IMMethods } from 'openim-uniapp-polyfill/src/types/enum'
import { requirePrivacyConsent } from '@/utils/privacy-consent'
export * from 'openim-uniapp-polyfill/src/types/enum'
export type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'

type NativeBridge = Record<string, (...args: unknown[]) => unknown>
const plugins = new Map<string, NativeBridge>()

function plugin(name: string): NativeBridge {
  requirePrivacyConsent()
  const cached = plugins.get(name)
  if (cached) return cached
  const bridge = uni.requireNativePlugin(name) as NativeBridge | null
  if (!bridge) throw new Error(`原生插件不可用：${name}`)
  plugins.set(name, bridge)
  return bridge
}

const normalMethods = new Set<IMMethods>([
  IMMethods.InitSDK, IMMethods.GetLoginStatus, IMMethods.GetLoginUserID,
  IMMethods.GetAtAllTag, IMMethods.CreateAdvancedTextMessage,
  IMMethods.CreateTextAtMessage, IMMethods.CreateTextMessage,
  IMMethods.CreateLocationMessage, IMMethods.CreateMarkdownMessage,
  IMMethods.CreateCustomMessage, IMMethods.CreateQuoteMessage,
  IMMethods.CreateAdvancedQuoteMessage, IMMethods.CreateCardMessage,
  IMMethods.CreateImageMessage, IMMethods.CreateImageMessageFromFullPath,
  IMMethods.CreateImageMessageByURL, IMMethods.CreateSoundMessage,
  IMMethods.CreateSoundMessageFromFullPath, IMMethods.CreateSoundMessageByURL,
  IMMethods.CreateVideoMessage, IMMethods.CreateVideoMessageFromFullPath,
  IMMethods.CreateVideoMessageByURL, IMMethods.CreateFileMessage,
  IMMethods.CreateFileMessageFromFullPath, IMMethods.CreateFileMessageByURL,
  IMMethods.CreateMergerMessage, IMMethods.CreateFaceMessage,
  IMMethods.CreateForwardMessage, IMMethods.GetConversationIDBySessionType,
  IMMethods.SetConversationGroupListener, IMMethods.GetSdkVersion,
])

function parseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

async function asyncApi(method: IMMethods, ...args: unknown[]): Promise<unknown> {
  const bridge = plugin('Tuoyun-OpenIMSDK')
  if (typeof bridge[method] !== 'function') throw new Error(`原生 SDK 不支持 ${method}`)
  if (normalMethods.has(method)) return parseJSON(bridge[method](...args))
  return new Promise((resolve, reject) => {
    bridge[method](...args, (result: { errCode: number; data: unknown; errMsg?: string }) => {
      if (result.errCode === 0) resolve({ ...result, data: parseJSON(result.data) })
      else reject(result)
    })
  })
}

function subscribe(event: IMEvents, handler: (data: Record<string, unknown>) => void) {
  plugin('globalEvent').addEventListener(event, handler)
}

function unsubscribe(event: IMEvents, handler: () => void) {
  plugin('globalEvent').removeEventListener(event, handler)
}

function pickFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    plugin('Tuoyun-OpenIMSDK-OUIFilePicker').pick((path: string) => {
      if (path) resolve(path)
      else reject(new Error('cancel'))
    })
  })
}

function getVideoCover(path: string): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    plugin('Tuoyun-OpenIMSDK-OUIFilePicker').getVideoAttributes(path, (result: { path: string }) => {
      if (result.path) resolve(result)
      else reject(new Error('无法获取视频封面'))
    })
  })
}

// 原生 sendMessage 等调用仍通过同步桥；读取任意方法前检查隐私授权。
const nomalApi = new Proxy({} as NativeBridge, {
  get(_target, key: string) {
    const bridge = plugin('Tuoyun-OpenIMSDK')
    return typeof bridge[key] === 'function' ? bridge[key].bind(bridge) : undefined
  },
})

export default {
  nomalApi, IMMethods, IMEvents, asyncApi, subscribe, unsubscribe, pickFile, getVideoCover,
  uuid: () => (Math.random() * 36).toString(36).slice(2) + Date.now().toString(),
}
