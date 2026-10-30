import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasPendingJoinRequest,
  isLegacyAdminJoinRequestConversation,
  joinRequestSeenAt,
  markJoinRequestSeen,
  replacePendingJoinRequests,
  setPendingJoinRequest,
} from '@/utils/conversation-highlight'

const storage = new Map<string, unknown>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('join request conversation highlight', () => {
  it('stores and clears a pending conversation per user', () => {
    setPendingJoinRequest('user-a', 'sg_group', true)
    expect(hasPendingJoinRequest('user-a', 'sg_group')).toBe(true)
    setPendingJoinRequest('user-a', 'sg_group', false)
    expect(hasPendingJoinRequest('user-a', 'sg_group')).toBe(false)
  })

  it('isolates different users', () => {
    setPendingJoinRequest('user-a', 'sg_group', true)
    expect(hasPendingJoinRequest('user-b', 'sg_group')).toBe(false)
  })

  it('ignores corrupted storage', () => {
    storage.set('im_join_request_pending_user-a', 'bad')
    expect(hasPendingJoinRequest('user-a', 'sg_group')).toBe(false)
  })

  it('recognizes only legacy imAdmin join-request conversations', () => {
    expect(
      isLegacyAdminJoinRequestConversation({
        type: 'private',
        id: 'si_owner_imAdmin',
        peerUserId: 'imAdmin',
        lastMessage: '[入群申请]',
      }),
    ).toBe(true)
    expect(
      isLegacyAdminJoinRequestConversation({
        type: 'private',
        id: 'si_owner_imAdmin',
        peerUserId: 'imAdmin',
        lastMessage: '其他系统消息',
      }),
    ).toBe(false)
  })

  it('replaces pending state with the server snapshot', () => {
    setPendingJoinRequest('user-a', 'sg_old', true)
    replacePendingJoinRequests('user-a', ['sg_new'])
    expect(hasPendingJoinRequest('user-a', 'sg_old')).toBe(false)
    expect(hasPendingJoinRequest('user-a', 'sg_new')).toBe(true)
  })

  it('persists the last seen time per conversation', () => {
    markJoinRequestSeen('user-a', 'sg_group', Date.parse('2026-10-30T12:00:00Z'))
    expect(joinRequestSeenAt('user-a', 'sg_group')).toBe(Date.parse('2026-10-30T12:00:00Z'))
    expect(joinRequestSeenAt('user-b', 'sg_group')).toBe(0)
  })
})
