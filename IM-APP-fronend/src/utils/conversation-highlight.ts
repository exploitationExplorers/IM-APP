export const JOIN_REQUEST_HIGHLIGHT_TAG = '[有新的进群申请]'

const PREFIX = 'im_join_request_pending_'
const SEEN_PREFIX = 'im_join_request_seen_'

export function isLegacyAdminJoinRequestConversation(conv: {
  type: 'private' | 'group'
  id: string
  peerUserId?: string
  lastMessage: string
}): boolean {
  return (
    conv.type === 'private' &&
    (conv.peerUserId === 'imAdmin' || conv.id.endsWith('_imAdmin')) &&
    conv.lastMessage === '[入群申请]'
  )
}

function keyOf(userId: string): string {
  return `${PREFIX}${userId || 'anon'}`
}

function seenKeyOf(userId: string): string {
  return `${SEEN_PREFIX}${userId || 'anon'}`
}

function readPending(userId: string): Record<string, boolean> {
  try {
    const raw = uni.getStorageSync(keyOf(userId))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, boolean> = {}
    for (const [conversationId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (conversationId && value === true) out[conversationId] = true
    }
    return out
  } catch {
    return {}
  }
}

export function hasPendingJoinRequest(userId: string, conversationId: string): boolean {
  return !!conversationId && readPending(userId)[conversationId] === true
}

export function setPendingJoinRequest(
  userId: string,
  conversationId: string,
  pending: boolean,
): void {
  if (!conversationId) return
  const next = readPending(userId)
  if (pending) next[conversationId] = true
  else delete next[conversationId]
  uni.setStorageSync(keyOf(userId), next)
}

export function replacePendingJoinRequests(
  userId: string,
  conversationIds: Iterable<string>,
): void {
  const next: Record<string, boolean> = {}
  for (const conversationId of conversationIds) {
    if (conversationId) next[conversationId] = true
  }
  uni.setStorageSync(keyOf(userId), next)
}

export function joinRequestSeenAt(userId: string, conversationId: string): number {
  if (!conversationId) return 0
  try {
    const raw = uni.getStorageSync(seenKeyOf(userId))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0
    const value = (raw as Record<string, unknown>)[conversationId]
    if (typeof value !== 'string') return 0
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export function markJoinRequestSeen(
  userId: string,
  conversationId: string,
  seenAt = Date.now(),
): void {
  if (!conversationId) return
  let next: Record<string, string> = {}
  try {
    const raw = uni.getStorageSync(seenKeyOf(userId))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (id && typeof value === 'string') next[id] = value
      }
    }
  } catch {
    next = {}
  }
  next[conversationId] = new Date(seenAt).toISOString()
  uni.setStorageSync(seenKeyOf(userId), next)
}
