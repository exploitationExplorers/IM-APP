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

export interface MessageRecallResult {
  peerType: 'c2c' | 'group'
  peerId: string
  clientMsgId: string
  seq: number
  status: 'recalled'
  /** true 表示该消息此前已撤回，本次为幂等命中 */
  alreadyRecalled: boolean
  recalledAt: string
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

/**
 * OpenIM 群 ID（会话列表拿到的 groupID）→ 业务群资料。
 * 聊天列表点进来时只有 OpenIM 群 ID，没有对外 public ID，靠它换出资料页所需的 ID。
 */
export async function resolveIMGroupByIM(imGroupId: string): Promise<IMGroupTarget> {
  return request<IMGroupTarget>({
    url: `/im/groups/by-im/${encodeURIComponent(imGroupId)}`,
    method: 'GET',
  })
}

/**
 * 清除当前用户在指定会话的服务端漫游历史，并同步到自己的其他登录设备。
 * 不影响私聊对方或其他群成员；操作不可恢复。
 */
export async function clearConversationHistory(
  peerType: 'c2c' | 'group',
  peerId: string,
): Promise<{ ok: boolean; scope: string }> {
  return request<{ ok: boolean; scope: string }>({
    url: '/im/conversation-messages/clear',
    method: 'POST',
    data: { peerType, peerId },
  })
}

/**
 * 撤回单条消息（私聊/群聊统一入口）。
 * peerId 传业务侧 ID：私聊为对方业务用户 UUID，群聊为数字群 ID；
 * 权限与撤回时间窗由服务端校验，群主/管理员撤回他人消息时 reason 必填。
 */
export async function recallMessage(input: {
  peerType: 'c2c' | 'group'
  peerId: string
  clientMsgId: string
  seq: number
  reason?: string
}): Promise<MessageRecallResult> {
  return request<MessageRecallResult>({
    url: '/im/messages/recall',
    method: 'POST',
    data: input,
  })
}

export async function registerPushToken(input: {
  platform: string
  channel?: string
  deviceToken: string
  enabled?: boolean
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: '/im/me/push-token',
    method: 'POST',
    data: input,
  })
}

export async function unregisterPushToken(deviceToken: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: '/im/me/push-token',
    method: 'DELETE',
    data: { deviceToken },
  })
}
