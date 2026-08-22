import { request } from '@/utils/request'
import type {
  Contact,
  ContactListQuery,
  ContactPage,
  ContactTagItem,
  FriendRequest,
  FriendRequestList,
  GroupFriendRequestResult,
  GroupPreview,
  SendFriendResult,
} from '@/types'

export async function fetchContacts(query: ContactListQuery = {}): Promise<ContactPage> {
  const data: Record<string, string | number> = {
    limit: query.limit ?? 50,
  }
  if (query.keyword?.trim()) data.keyword = query.keyword.trim()
  if (query.sort) data.sort = query.sort
  if (query.cursor) data.cursor = query.cursor
  const result = await request<ContactPage | Contact[]>({
    url: '/contacts',
    method: 'GET',
    data,
  })

  // 兼容仍直接返回数组的旧版服务，同时保持分页调用方的数据结构稳定。
  return Array.isArray(result)
    ? { items: result, hasMore: false, total: result.length }
    : result
}

export async function fetchContact(contactId: string): Promise<Contact> {
  return request<Contact>({ url: `/contacts/${contactId}`, method: 'GET' })
}

export async function updateContact(
  contactId: string,
  data: { remark?: string; tagIds?: string[] },
): Promise<Contact> {
  return request<Contact>({
    url: `/contacts/${contactId}`,
    method: 'PATCH',
    data,
  })
}

export async function fetchGroups(role?: 'owner' | 'member'): Promise<GroupPreview[]> {
  const data: Record<string, string> = {}
  if (role === 'owner') data.role = 'owner'
  else if (role === 'member') data.role = 'member'
  return request<GroupPreview[]>({ url: '/groups', method: 'GET', data })
}

function normalizeFriendRequestList(raw: unknown): FriendRequestList {
  if (!raw) return { pending: [], recent: [] }
  if (typeof raw === 'string') {
    try {
      return normalizeFriendRequestList(JSON.parse(raw) as unknown)
    } catch {
      return { pending: [], recent: [] }
    }
  }
  if (Array.isArray(raw)) {
    return { pending: raw, recent: [] }
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    // 兼容 App 端偶发双层 data 包装
    if (obj.data && typeof obj.data === 'object') {
      const inner = obj.data as Record<string, unknown>
      if (Array.isArray(inner) || 'pending' in inner || 'recent' in inner) {
        return normalizeFriendRequestList(obj.data)
      }
    }
    return {
      pending: Array.isArray(obj.pending) ? (obj.pending as FriendRequest[]) : [],
      recent: Array.isArray(obj.recent) ? (obj.recent as FriendRequest[]) : [],
    }
  }
  return { pending: [], recent: [] }
}

export async function fetchFriendRequests(): Promise<FriendRequestList> {
  const result = await request<FriendRequestList | FriendRequest[] | string>({
    url: `/friend-requests?direction=received&_=${Date.now()}`,
    method: 'GET',
    header: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
  return normalizeFriendRequestList(result)
}

export async function sendFriendRequest(toUserId: string, message: string): Promise<SendFriendResult> {
  return request<SendFriendResult>({
    url: '/friend-requests',
    method: 'POST',
    data: { toUserId, message },
  })
}

/**
 * 从群成员资料发起好友申请。
 * 服务端校验双方均为该群有效成员且群开启 allowMemberAddFriend；
 * 群内关闭加好友只限制该来源，不影响公开 ID / 二维码加好友。
 */
export async function sendGroupFriendRequest(
  groupId: string,
  toUserId: string,
  message = '',
): Promise<GroupFriendRequestResult> {
  return request<GroupFriendRequestResult>({
    url: '/group-friend-requests',
    method: 'POST',
    data: { groupId, toUserId, message },
  })
}

export async function acceptFriendRequest(requestId: string) {
  return request<{ ok: boolean }>({
    url: `/friend-requests/${requestId}/accept`,
    method: 'POST',
  })
}

export async function rejectFriendRequest(requestId: string) {
  return request<{ ok: boolean }>({
    url: `/friend-requests/${requestId}/reject`,
    method: 'POST',
  })
}

export async function deleteContact(contactId: string) {
  return request<{ ok: boolean }>({
    url: `/contacts/${contactId}`,
    method: 'DELETE',
  })
}

export async function blockContact(contactId: string) {
  return request<{ ok: boolean }>({
    url: `/contacts/${contactId}/block`,
    method: 'POST',
  })
}

export async function unblockContact(contactId: string) {
  return request<{ ok: boolean }>({
    url: `/contacts/${contactId}/block`,
    method: 'DELETE',
  })
}

export interface BlockedUser {
  id: string
  publicId?: string
  nickname: string
  avatar: string
  blockedAt: string
}

export async function fetchBlacklist(params?: { keyword?: string; limit?: number }) {
  return request<{ items: BlockedUser[]; total: number }>({
    url: '/contacts/blocked',
    method: 'GET',
    data: params,
  })
}

export async function fetchContactTags(): Promise<ContactTagItem[]> {
  return request<ContactTagItem[]>({ url: '/contact-tags', method: 'GET' })
}

export async function createContactTag(name: string): Promise<ContactTagItem> {
  return request<ContactTagItem>({
    url: '/contact-tags',
    method: 'POST',
    data: { name },
  })
}

export async function fetchTagMembers(tagId: string): Promise<Contact[]> {
  return request<Contact[]>({
    url: `/contact-tags/${encodeURIComponent(tagId)}/members`,
    method: 'GET',
  })
}

export async function setTagMembers(tagId: string, userIds: string[]): Promise<ContactTagItem> {
  return request<ContactTagItem>({
    url: `/contact-tags/${encodeURIComponent(tagId)}/members`,
    method: 'PUT',
    data: { userIds },
  })
}

export async function updateContactTag(tagId: string, name: string): Promise<ContactTagItem> {
  return request<ContactTagItem>({
    url: `/contact-tags/${encodeURIComponent(tagId)}`,
    method: 'PATCH',
    data: { name },
  })
}

export async function deleteContactTag(tagId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: `/contact-tags/${encodeURIComponent(tagId)}`,
    method: 'DELETE',
  })
}
