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
