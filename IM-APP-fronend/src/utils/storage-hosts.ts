/**
 * 已知聊天对象存储主机：既包含 CDN 加速域名，也包含签名直连域名。
 *
 * ⚠️ 这个集合的语义是「这个主机上的地址字节级不可改写」（供 isOSSStorageUrl 用），
 * 以及「可以安全追加 x-oss-process」（供 withPublicImageProcess 用）。
 * 它**不能**用来判断「地址是否永不过期」——
 * oss-chat-test.* 上的地址带 OSS 签名、7 天就过期，显示前必须重新签名。
 * 需要「永不过期」语义请用 isPermanentChatCDNHost。
 */
const CHAT_CDN_HOSTS = new Set([
  'oss-chat.whs188.xin',
  'oss-chat-test.xn--jprz53bj9s.com',
])

/**
 * 真·CDN 域名：地址无签名、不会过期，可以一直直接用。
 *
 * 与 CHAT_CDN_HOSTS 的差别就在签名直连域名 oss-chat-test.*：
 * 那里的 URL 带 Expires/Signature，过期后直接 403。老消息里的图正是这种地址，
 * 如果也当成「永不过期」跳过还原，老图就永远显示不出来。
 */
const CHAT_CDN_PERMANENT_HOSTS = new Set(['oss-chat.whs188.xin'])

const BUSINESS_CDN_HOSTS = new Set([
  'oss-business.whs188.xin',
  'oss-business-test.xn--jprz53bj9s.com',
])

function normalizedHostname(hostname: string): string {
  return String(hostname || '').trim().toLowerCase()
}

export function isChatCDNHost(hostname: string): boolean {
  return CHAT_CDN_HOSTS.has(normalizedHostname(hostname))
}

export function isBusinessCDNHost(hostname: string): boolean {
  return BUSINESS_CDN_HOSTS.has(normalizedHostname(hostname))
}

/** 该主机上的聊天地址是否无签名、不会过期（只有真 CDN 域名满足）。 */
export function isPermanentChatCDNHost(hostname: string): boolean {
  return CHAT_CDN_PERMANENT_HOSTS.has(normalizedHostname(hostname))
}

export function isKnownStorageCDNHost(hostname: string): boolean {
  const normalized = normalizedHostname(hostname)
  return CHAT_CDN_HOSTS.has(normalized) || BUSINESS_CDN_HOSTS.has(normalized)
}