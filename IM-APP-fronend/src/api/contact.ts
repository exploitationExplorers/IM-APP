import { request } from '@/utils/request'
import type { Contact, FriendRequest, GroupPreview } from '@/types'

export async function fetchContacts(): Promise<Contact[]> {
  return request<Contact[]>({ url: '/contacts', method: 'GET' })
}

export async function fetchGroups(): Promise<GroupPreview[]> {
  return request<GroupPreview[]>({ url: '/groups', method: 'GET' })
}

export async function fetchFriendRequests(): Promise<FriendRequest[]> {
  return request<FriendRequest[]>({ url: '/friend-requests', method: 'GET' })
}

export async function sendFriendRequest(toUserId: string, message: string) {
  return request<{ ok: boolean; id: string }>({
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
