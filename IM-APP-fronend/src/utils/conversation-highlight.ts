export const JOIN_REQUEST_HIGHLIGHT_TAG = '[有新的进群申请]'

const PREFIX = 'im_join_request_pending_'

function keyOf(userId: string): string {
  return `${PREFIX}${userId || 'anon'}`
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
