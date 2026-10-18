import { request } from '@/utils/request'

export interface GroupRetentionState {
  conversationId: string
  minVisibleSeq: number
  revision: number
  updatedAt: string
}

/** Only durable applied server state, never a local 7-day timestamp estimate. */
export function fetchGroupRetentionStates(conversationIds: string[]) {
  return request<{ items: GroupRetentionState[] }>({
    url: `/im/group-retention/states?conversationIds=${encodeURIComponent(conversationIds.join(','))}`,
    method: 'GET',
  })
}
