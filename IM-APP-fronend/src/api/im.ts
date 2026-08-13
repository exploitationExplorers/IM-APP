import { request } from '@/utils/request'

export interface IMTokenResult {
  userId: string
  token: string
  platform: number
  expireSec: number
  /** OpenIM REST 地址，由后端下发，前端不得硬编码 */
  apiAddr: string
  /** OpenIM WebSocket 地址，由后端下发，前端不得硬编码 */
  wsAddr: string
}

export interface IMPeerTarget {
  businessUserId: string
  imUserId: string
  nickname: string
  avatar: string
  canChat: boolean
  denyReason: string
}

export interface IMGroupTarget {
  businessGroupId: string
  imGroupId: string
  name: string
  avatar: string
  role: string
  canChat: boolean
  denyReason: string
  mutedUntil: string | null
}

export async function fetchIMToken(platformId = 5): Promise<IMTokenResult> {
  return request<IMTokenResult>({
    url: '/im/token',
    method: 'POST',
    data: { platformId },
  })
}

/** 业务用户 ID → OpenIM 用户 ID，同时返回服务端的可聊天判定 */
export async function resolveIMPeer(businessUserId: string): Promise<IMPeerTarget> {
  return request<IMPeerTarget>({
    url: `/im/peers/${encodeURIComponent(businessUserId)}`,
    method: 'GET',
  })
}

/** 业务群 ID → OpenIM 群 ID，同时返回禁言与成员身份 */
export async function resolveIMGroup(businessGroupId: string): Promise<IMGroupTarget> {
  return request<IMGroupTarget>({
    url: `/im/groups/${encodeURIComponent(businessGroupId)}`,
    method: 'GET',
  })
}
