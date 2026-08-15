import { request } from '@/utils/request'
import type { Contact, ContactTagItem, FriendRequest, GroupPreview, SendFriendResult } from '@/types'

interface ContactListResult {
  items: Contact[]
  hasMore: boolean
  total: number
}

export async function fetchContacts(): Promise<Contact[]> {
  const result = await request<Contact[] | ContactListResult>({
    url: '/contacts',
    method: 'GET',
  })

  // 线上接口返回分页对象；兼容仍直接返回数组的旧版服务。
  return Array.isArray(result) ? result : result.items
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

export async function fetchFriendRequests(): Promise<FriendRequest[]> {
  return request<FriendRequest[]>({ url: '/friend-requests', method: 'GET' })
}

export async function sendFriendRequest(toUserId: string, message: string): Promise<SendFriendResult> {
  return request<SendFriendResult>({
    url: '/friend-requests',
    method: 'POST',
    data: { toUserId, message },
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
