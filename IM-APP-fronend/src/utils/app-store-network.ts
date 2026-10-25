import { APP_CONFIG } from '@/config'
import { isOSSStorageUrl } from '@/utils/storage-url'

export function requireSecureEndpoint(raw: string, kind: 'api' | 'ws' = 'api'): string {
  const expected = kind === 'ws' ? 'wss:' : 'https:'
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('服务地址无效，请联系客服') }
  if (url.protocol !== expected || url.username || url.password) {
    throw new Error('服务地址不支持安全连接，请联系客服')
  }
  return raw
}

/** 旧消息仅通过已有 HTTPS 网关访问；不更改 OSS 签名直链的主机、协议或查询串。 */
export function storeMediaUrl(raw: string): string {
  if (!APP_CONFIG.appStore || !/^http:\/\//i.test(raw)) return raw
  if (isOSSStorageUrl(raw)) return ''
  try {
    const url = new URL(raw)
    if (url.hostname !== '8.154.44.197' || !/^\/(object|openim|minio|openim-api)\//.test(url.pathname)) return ''
    const base = new URL(requireSecureEndpoint(APP_CONFIG.apiBaseUrl))
    return `${base.origin}${url.pathname}${url.search}${url.hash}`
  } catch {
    return ''
  }
}
