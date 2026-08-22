const BADGE_KEY = 'im_friend_request_badge'
const EVENT = 'friend-requests-updated'

export function writeFriendRequestBadge(count: number) {
  const n = Math.max(0, Math.floor(count))
  uni.setStorageSync(BADGE_KEY, n)
  uni.$emit(EVENT, n)
}

export function readFriendRequestBadge(): number {
  const n = Number(uni.getStorageSync(BADGE_KEY) || 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function clearFriendRequestBadge() {
  uni.removeStorageSync(BADGE_KEY)
  uni.$emit(EVENT, 0)
}

export function onFriendRequestBadgeUpdated(cb: (count: number) => void) {
  uni.$on(EVENT, cb)
  return () => uni.$off(EVENT, cb)
}
