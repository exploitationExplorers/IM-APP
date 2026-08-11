import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import type { Contact, FriendRequest, GroupPreview } from '@/types'
import {
  mockAcceptFriendRequest,
  mockBlockContact,
  mockDeleteContact,
  mockFetchContacts,
  mockFetchFriendRequests,
  mockFetchGroups,
  mockGetContactConversationId,
  mockRejectFriendRequest,
  mockSendFriendRequest,
  mockUnblockContact,
} from '@/mock/handlers/contact'

export async function fetchContacts(): Promise<Contact[]> {
  if (APP_CONFIG.useMock) {
    return mockFetchContacts()
  }
  return request<Contact[]>({ url: '/contacts', method: 'GET' })
}

export async function fetchGroups(): Promise<GroupPreview[]> {
  if (APP_CONFIG.useMock) {
    return mockFetchGroups()
  }
  return request<GroupPreview[]>({ url: '/groups', method: 'GET' })
}

export async function fetchFriendRequests(): Promise<FriendRequest[]> {
  if (APP_CONFIG.useMock) {
    return mockFetchFriendRequests()
  }
  return request<FriendRequest[]>({ url: '/friend-requests', method: 'GET' })
}

export async function sendFriendRequest(toUserId: string, message: string) {
  if (APP_CONFIG.useMock) {
    return mockSendFriendRequest(toUserId, message)
  }
  return request<{ ok: boolean; id: string }>({
    url: '/friend-requests',
    method: 'POST',
    data: { toUserId, message },
  })
}

export async function acceptFriendRequest(requestId: string) {
  if (APP_CONFIG.useMock) {
    return mockAcceptFriendRequest(requestId)
  }
  return request<{ ok: boolean }>({
    url: `/friend-requests/${requestId}/accept`,
    method: 'POST',
  })
}

export async function rejectFriendRequest(requestId: string) {
  if (APP_CONFIG.useMock) {
    return mockRejectFriendRequest(requestId)
  }
  return request<{ ok: boolean }>({
    url: `/friend-requests/${requestId}/reject`,
    method: 'POST',
  })
}

export async function deleteContact(contactId: string) {
  if (APP_CONFIG.useMock) {
    return mockDeleteContact(contactId)
  }
  return request<{ ok: boolean }>({
    url: `/contacts/${contactId}`,
    method: 'DELETE',
  })
}

export async function blockContact(contactId: string) {
  if (APP_CONFIG.useMock) {
    return mockBlockContact(contactId)
  }
  return request<{ ok: boolean }>({
    url: `/contacts/${contactId}/block`,
    method: 'POST',
  })
}

export async function unblockContact(contactId: string) {
  if (APP_CONFIG.useMock) {
    return mockUnblockContact(contactId)
  }
  return request<{ ok: boolean }>({
    url: `/contacts/${contactId}/block`,
    method: 'DELETE',
  })
}

export async function getContactConversationId(contactId: string): Promise<string | null> {
  if (APP_CONFIG.useMock) {
    return mockGetContactConversationId(contactId)
  }
  return request<string | null>({
    url: `/contacts/${contactId}/conversation`,
    method: 'GET',
  })
}
