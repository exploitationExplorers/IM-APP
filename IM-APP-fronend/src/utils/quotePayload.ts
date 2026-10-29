import type { MessageItem } from 'openim-uniapp-polyfill'

/**
 * 引用/转发的载荷构造与纠错（纯函数，不依赖 uni / SDK，便于单测）。
 *
 * 背景：部分 App 基座的原生 CreateQuoteMessage 会 resolve 一个缺字段的结果
 * （只带回 *Elem，不带 contentType；甚至空对象），前端判成「创建消息结果无效」，
 * 表现为 iOS 上所有类型的引用消息都发不出去。这里把它需要的纠错集中处理。
 */

/** contentType -> elem 字段名的协议映射（OpenIM 标准） */
const ELEM_BY_CONTENT_TYPE: Record<number, string> = {
  101: 'textElem',
  102: 'pictureElem',
  103: 'soundElem',
  104: 'videoElem',
  105: 'fileElem',
  106: 'atTextElem',
  107: 'mergeElem',
  114: 'quoteElem',
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(obj[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

function pascal(key: string): string {
  return key[0].toUpperCase() + key.slice(1)
}

function parseContent(raw: unknown): unknown {
  if (typeof raw === 'string' && raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null) return parsed
    } catch {
      return { content: raw }
    }
  }
  if (raw && typeof raw === 'object') return raw
  return null
}

/**
 * 从原生创建结果推断消息类型。
 * 个别基座创建引用消息只带回 *Elem 且没有 contentType，必须按 elem 反推，
 * 否则会被判成无效结果。推不出来返回 0（调用方按无效处理）。
 */
export function inferNativeMessageType(raw: Record<string, unknown>): number {
  const declared = pickNumber(raw, ['contentType', 'ContentType'])
  if (declared > 0) return declared
  for (const [type, elem] of Object.entries(ELEM_BY_CONTENT_TYPE)) {
    if (raw[elem] != null || raw[pascal(elem)] != null) return Number(type)
  }
  return 0
}

/** 引用只展示摘要，不必把整条原消息塞给原生桥（超大载荷会让部分基座创建失败） */
export function slimQuotedMessage(source: MessageItem): MessageItem {
  const raw = source as unknown as Record<string, unknown>
  const contentType = pickNumber(raw, ['contentType', 'ContentType'])
  const slim: Record<string, unknown> = {}
  for (const key of [
    'clientMsgID',
    'serverMsgID',
    'sendID',
    'recvID',
    'groupID',
    'senderNickname',
    'senderFaceUrl',
    'sessionType',
    'sendTime',
    'createTime',
    'seq',
    'status',
  ]) {
    const value = raw[key] ?? raw[pascal(key)]
    if (value !== undefined && value !== null && value !== '') slim[key] = value
  }
  slim.contentType = contentType
  slim.ContentType = contentType
  const elem = ELEM_BY_CONTENT_TYPE[contentType]
  if (elem) {
    const value =
      asPlainObject(raw[elem]) ??
      asPlainObject(raw[pascal(elem)]) ??
      asPlainObject(parseContent(raw.content ?? raw.Content))
    if (value) {
      slim[elem] = value
      slim[pascal(elem)] = value
    }
  }
  const content = raw.content ?? raw.Content
  if (typeof content === 'string' && content) slim.content = content
  return slim as unknown as MessageItem
}

/** 原生创建消息返回空/缺字段，不是业务拒绝：可以降级重试 */
export function isNativeCreateResultError(e: unknown): boolean {
  return String((e as Error)?.message || '').includes('创建消息结果无效')
}

/** 报错时把原生返回的形态摘出来，便于定位是哪一类基座不合规 */
export function describeNativeCreateResult(raw: unknown): string {
  if (raw == null) return `raw=${String(raw)}`
  if (typeof raw === 'string') return `raw(string)=${raw.slice(0, 200)}`
  if (typeof raw !== 'object') return `raw=${String(raw)}`
  const obj = raw as Record<string, unknown>
  return `keys=[${Object.keys(obj).slice(0, 30).join(',')}] contentType=${
    obj.contentType ?? obj.ContentType ?? '∅'
  }`
}
