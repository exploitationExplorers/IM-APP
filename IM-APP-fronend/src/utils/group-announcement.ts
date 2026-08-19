/** 与 OpenIM GroupAtType 对齐：会话预览红色提醒档位 */
export const GroupAtType = {
  AtNormal: 0,
  AtMe: 1,
  AtAll: 2,
  AtAllAtMe: 3,
  AtGroupNotice: 4,
} as const

const DISMISSED_PREFIX = 'im_announcement_dismissed_'
const UNREAD_PREFIX = 'im_announcement_unread_'

function readStringMap(key: string): Record<string, string> {
  try {
    const raw = uni.getStorageSync(key)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && id) out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

function readFlagMap(key: string): Record<string, boolean> {
  try {
    const raw = uni.getStorageSync(key)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!id || typeof value !== 'boolean') continue
      out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

function dismissedKey(userId: string) {
  return `${DISMISSED_PREFIX}${userId || 'anon'}`
}

function unreadKey(userId: string) {
  return `${UNREAD_PREFIX}${userId || 'anon'}`
}

export function isAtMeType(groupAtType: number | undefined): boolean {
  return (
    groupAtType === GroupAtType.AtMe ||
    groupAtType === GroupAtType.AtAll ||
    groupAtType === GroupAtType.AtAllAtMe
  )
}

/** 会话列表预览红色标签：可同时出现 [有人@你] 与 [有新公告] */
export function highlightTagsOf(groupAtType: number | undefined, hasUnreadAnnouncement: boolean): string[] {
  const tags: string[] = []
  if (isAtMeType(groupAtType)) tags.push('[有人@你]')
  if (groupAtType === GroupAtType.AtGroupNotice || hasUnreadAnnouncement) tags.push('[有新公告]')
  return tags
}

export function isAnnouncementDismissed(userId: string, conversationId: string, content: string): boolean {
  if (!conversationId || !content) return true
  return readStringMap(dismissedKey(userId))[conversationId] === content
}

export function rememberDismissedAnnouncement(userId: string, conversationId: string, content: string) {
  if (!conversationId) return
  const key = dismissedKey(userId)
  const map = readStringMap(key)
  map[conversationId] = content
  uni.setStorageSync(key, map)
}

export function unreadAnnouncementState(userId: string, conversationId: string): boolean | undefined {
  const map = readFlagMap(unreadKey(userId))
  return conversationId in map ? map[conversationId] : undefined
}

export function writeUnreadAnnouncement(userId: string, conversationId: string, unread: boolean) {
  if (!conversationId) return
  const key = unreadKey(userId)
  const map = readFlagMap(key)
  map[conversationId] = unread
  uni.setStorageSync(key, map)
}
