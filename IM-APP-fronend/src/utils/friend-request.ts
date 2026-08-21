import type { FriendRequest } from '../types/contact'

/**
 * 同一申请人只展示最近一条待处理申请。
 * 服务端已经从数据源合并，这里用于兼容尚未执行迁移的旧环境和多端缓存。
 */
export function mergeReceivedFriendRequests(requests: FriendRequest[]): FriendRequest[] {
  const latestByUser = new Map<string, FriendRequest>()

  requests.forEach((request) => {
    if (request.status !== 'pending') return
    const key = request.fromUser.id || request.id
    const current = latestByUser.get(key)
    if (!current || request.createdAt > current.createdAt) {
      latestByUser.set(key, request)
    }
  })

  return [...latestByUser.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}
