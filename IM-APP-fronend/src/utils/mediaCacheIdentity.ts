const AUTH_QUERY_KEYS = new Set([
  'expires',
  'ossaccesskeyid',
  'signature',
  'security-token',
  'token',
  'access_token',
  'x-oss-signature',
  'x-oss-signature-version',
  'x-oss-credential',
  'x-oss-date',
  'x-oss-expires',
  'x-oss-security-token',
])

const H5_CHAT_MEDIA_PATHS = ['/object/', '/api/v1/public/oss-media']

function isAuthQueryKey(name: string): boolean {
  const key = name.toLowerCase()
  return AUTH_QUERY_KEYS.has(key) || key.startsWith('x-amz-')
}

function currentH5Origin(): string {
  try {
    if (typeof location === 'undefined' || !/^https?:$/i.test(location.protocol)) return ''
    return location.origin
  } catch {
    return ''
  }
}

function isRelativeChatMediaPath(path: string): boolean {
  if (path.startsWith(H5_CHAT_MEDIA_PATHS[0])) return true
  return H5_CHAT_MEDIA_PATHS.slice(1).some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`),
  )
}

/**
 * Returns the exact URL used to download chat media.
 * H5 chat entries are root-relative, but IndexedDB/fetch and stable cache keys
 * need an absolute same-origin URL. Do not broaden this to arbitrary relative
 * assets: avatars, business media and /static files must keep their old path.
 */
export function cacheableChatMediaUrl(url: string, origin = currentH5Origin()): string {
  const raw = (url || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw) || raw.startsWith('blob:')) return raw
  if (!isRelativeChatMediaPath(raw)) return ''
  if (!/^https?:\/\//i.test(origin)) return ''
  try {
    const base = new URL(origin)
    const resolved = new URL(raw, base.origin)
    return resolved.origin === base.origin ? resolved.toString() : ''
  } catch {
    return ''
  }
}

/**
 * 媒体缓存身份：同一 OSS 对象的签名轮换、查询参数顺序变化不能造成重复下载。
 * 该值只用于本地缓存索引；真正的 fetch/downloadFile 必须继续使用原签名 URL。
 */
export function mediaCacheIdentity(url: string): string {
  const raw = (url || '').trim()
  if (!raw) return ''
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return raw
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw

  const pairs: Array<[string, string]> = []
  parsed.searchParams.forEach((value, name) => {
    if (!isAuthQueryKey(name)) pairs.push([name, value])
  })
  pairs.sort(([aName, aValue], [bName, bValue]) => {
    const nameOrder = aName.localeCompare(bName)
    return nameOrder || aValue.localeCompare(bValue)
  })

  const query = new URLSearchParams()
  for (const [name, value] of pairs) query.append(name, value)
  const normalized = new URL(parsed.origin + parsed.pathname)
  normalized.search = query.toString()
  return normalized.toString()
}

export function mediaCacheLegacyKey(owner: string, url: string): string {
  return JSON.stringify([owner, (url || '').trim()])
}

export function previewMediaCacheKey(owner: string, url: string): string {
  return JSON.stringify([owner, mediaCacheIdentity(url)])
}
