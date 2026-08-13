import { APP_CONFIG } from '@/config'
import { getToken } from '@/utils/request'

export interface OpenIMTokenResult {
  token: string
  expireSec: number
  platform: number
  userId: string
  devMode?: boolean
}

/** Phase 4：OpenIM SDK 接入入口 */
export async function fetchOpenIMToken(platformId = 5): Promise<OpenIMTokenResult> {
  const base = APP_CONFIG.apiBaseUrl.replace(/\/api\/v1$/, '')
  const jwt = getToken()
  const res = await fetch(`${base}/api/v1/im/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ platformId }),
  })
  const body = (await res.json()) as { code: number; data: OpenIMTokenResult; message: string }
  if (body.code !== 0) throw new Error(body.message || '获取 IM Token 失败')
  return body.data
}

/** 是否应使用 OpenIM SDK 替代自研 WebSocket（Phase 4 完成后启用） */
export function shouldUseOpenIM(): boolean {
  return Boolean(import.meta.env.VITE_OPENIM_ENABLED === 'true')
}

/**
 * 初始化 OpenIM SDK（占位）。
 * Phase 4 接入真实 SDK 后在此调用 login/getConversationList 等。
 */
export async function initOpenIM(): Promise<void> {
  if (!shouldUseOpenIM()) return
  const imToken = await fetchOpenIMToken()
  console.info('[openim] token ready', imToken.userId, imToken.devMode ? '(dev)' : '')
}
