/** 引用预览摘要：媒体用类型名（与参考站一致，无方括号），文本截断 */

/**
 * 判断是否像图片地址。
 * App 端图片 content 经常是 file://、content:// 或 /storage/... 本地路径，
 * 不能只认 http(s)，否则引用摘要会退化成一长串路径。
 */
export function looksLikeImageUrl(value: string): boolean {
  const t = value.trim()
  if (!t) return false
  if (/^(file|content):\/\//i.test(t)) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|heic)(\?|#|$)/i.test(t) || /\/storage\//i.test(t)
  }
  if (/^\/(storage|data|sdcard)\//i.test(t) || t.includes('/Android/data/')) {
    return true
  }
  if (!/^https?:\/\//i.test(t)) return false
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic)(\?|#|$)/i.test(t)) return true
  if (/[?&]type=image\b/i.test(t)) return true
  // 本项目对象存储图片常见无后缀：/object/<uuid>
  if (/\/object\/[a-zA-Z0-9_-]+\/?(\?|$)/i.test(t)) return true
  return false
}

/** 统一推断引用展示用的消息类型（App 原生桥偶发类型丢失时靠 content 兜底） */
export function resolveQuoteType(type: string, content: string): string {
  if (type === 'image' || type === 'video' || type === 'voice' || type === 'file' || type === 'card') {
    return type
  }
  if (looksLikeImageUrl(content)) return 'image'
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as {
        snapshotUrl?: string
        url?: string
        path?: string
        avatar?: string
        duration?: number
      }
      if (obj.snapshotUrl || (obj.url && looksLikeImageUrl(obj.url))) return 'video'
      if (typeof obj.path === 'string' && obj.path && typeof obj.duration === 'number') return 'voice'
      if (typeof obj.avatar === 'string' && ('userId' in obj || 'nickname' in obj)) return 'card'
    } catch {
      /* 非 JSON */
    }
  }
  return type || 'text'
}

export function quoteSummaryOf(type: string, content: string): string {
  switch (resolveQuoteType(type, content)) {
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'voice':
      return '语音'
    case 'file':
      return '文件'
    case 'card':
      return '名片'
    case 'groupInvite':
      return '群邀请'
    case 'system':
      return '消息'
    default: {
      const t = content.replace(/\s+/g, ' ').trim()
      if (!t) return '消息'
      // 兜底：即使类型未知，也不要把媒体地址铺到 UI 上
      if (looksLikeImageUrl(t)) return '图片'
      if (/^https?:\/\//i.test(t) || /^(file|content):\/\//i.test(t)) return '消息'
      return t.length > 36 ? `${t.slice(0, 36)}…` : t
    }
  }
}

/**
 * 引用块左侧缩略图：图片/视频用内容封面，名片用名片头像，其余回退发送者头像。
 * senderAvatar 仅作非媒体兜底，不要当成图片引用的默认值。
 */
export function quoteThumbOf(type: string, content: string, senderAvatar?: string): string {
  const resolved = resolveQuoteType(type, content)
  if (resolved === 'image') {
    const url = content.trim()
    return url || senderAvatar || ''
  }
  if (resolved === 'video') {
    try {
      const meta = JSON.parse(content) as { snapshotUrl?: string; url?: string }
      return (meta.snapshotUrl || meta.url || '').trim() || senderAvatar || ''
    } catch {
      return content.trim() || senderAvatar || ''
    }
  }
  if (resolved === 'card') {
    try {
      const card = JSON.parse(content) as { avatar?: string }
      return (card.avatar || '').trim() || senderAvatar || ''
    } catch {
      return senderAvatar || ''
    }
  }
  return senderAvatar || ''
}

/** 相对时间等格式化 */

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = Date.now()
  const diff = Math.max(0, now - date.getTime())
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  const m = date.getMonth() + 1
  const d = date.getDate()
  return `${m}/${d}`
}

/** 收藏列表日期：今日 / 昨日 / 8月15日 */
export function formatFavoriteDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(date)) / 86400000)
  if (diff === 0) return '今日'
  if (diff === 1) return '昨日'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatClock(iso: string): string {
  const date = new Date(iso)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 聊天气泡 / 系统提示用的上午下午时间，例如「上午 11:29」「下午 9:08」 */
export function formatMeridiemClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hour24 = date.getHours()
  const minute = String(date.getMinutes()).padStart(2, '0')
  let hour = hour24 % 12
  if (hour === 0) hour = 12
  return `${hour24 < 12 ? '上午' : '下午'} ${hour}:${minute}`
}

/**
 * 消息列表按天分隔。今天不单独出日期条（只看具体钟点）；
 * 昨天 / 近 7 天星期 / 更早的月日，和参考聊天记录一致。
 */
export function formatChatDayLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((start(now) - start(date)) / 86400000)
  if (diff <= 0) return ''
  if (diff === 1) return '昨天'
  if (diff < 7) return `星期${'日一二三四五六'[date.getDay()]}`
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`
  if (date.getFullYear() !== now.getFullYear()) return `${date.getFullYear()}年${monthDay}`
  return monthDay
}

/** 加好友 / 入群这类要给人看的时间点：今天带钟点，更早带日期 */
export function formatEventTime(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = formatChatDayLabel(iso) || '今天'
  const clock = formatMeridiemClock(iso)
  return clock ? `${day} ${clock}` : day
}

/**
 * 私聊顶栏离线时间，方便判断客户多久没上线。
 * 在线优先；没有最后上线时间时不展示，避免把新号误写成「很久未上线」。
 */
export function formatLastSeen(iso: string | undefined, online: boolean): string {
  if (online) return '在线'
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60 * 1000) return '刚刚在线'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前在线`
  if (diff < 24 * 60 * 60 * 1000) return '今天在线'
  if (diff < 2 * 24 * 60 * 60 * 1000) return '昨天在线'
  if (diff < 7 * 24 * 60 * 60 * 1000) return '1周内有上线'
  if (diff < 30 * 24 * 60 * 60 * 1000) return '1个月内有上线'
  return '很久未上线'
}

/** 将文本中的 URL 拆成片段，便于渲染可点击链接 */
export function splitTextWithLinks(text: string): Array<{ type: 'text' | 'link'; value: string }> {
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi
  const parts: Array<{ type: 'text' | 'link'; value: string }> = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = urlRe.exec(text))) {
    if (match.index > last) {
      parts.push({ type: 'text', value: text.slice(last, match.index) })
    }
    parts.push({ type: 'link', value: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  if (!parts.length) parts.push({ type: 'text', value: text })
  return parts
}
