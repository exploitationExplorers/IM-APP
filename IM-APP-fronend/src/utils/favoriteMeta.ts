const TITLE_KEY = 'im_favorite_conv_titles'

function readTitles(): Record<string, string> {
  const raw = uni.getStorageSync(TITLE_KEY)
  if (!raw || typeof raw !== 'object') return {}
  return raw as Record<string, string>
}

/** 收藏时记下会话名，列表页不依赖后端加字段也能显示「观察世界的窗口」 */
export function rememberConversationTitle(conversationId: string, title: string) {
  const id = conversationId.trim()
  const name = title.trim()
  if (!id || !name) return
  const map = readTitles()
  map[id] = name
  uni.setStorageSync(TITLE_KEY, map)
}

export function conversationTitleOf(conversationId: string, fallback = '聊天'): string {
  const name = readTitles()[conversationId]?.trim()
  return name || fallback
}
