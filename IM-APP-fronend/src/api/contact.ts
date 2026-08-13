import { request } from '@/utils/request'
import type { Contact, ContactTagItem, FriendRequest, GroupPreview, SendFriendResult } from '@/types'

export async function fetchContacts(): Promise<Contact[]> {
  return request<Contact[]>({ url: '/contacts', method: 'GET' })
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

export async function getContactConversationId(contactId: string): Promise<string | null> {
  return request<string | null>({
    url: `/contacts/${contactId}/conversation`,
    method: 'GET',
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
