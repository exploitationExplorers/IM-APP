import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { ChatMessage } from '@/types'

const api = vi.hoisted(() => ({ purge: vi.fn(), kick: vi.fn() }))
vi.mock('@/api/group', () => ({ purgeGroupMemberMessages: api.purge, removeGroupMember: api.kick }))
vi.mock('@/utils/openim', () => ({ businessUserIdFromIM: (id: string) => id }))
import { createKickActions } from '@/composables/chatMessageActions/kickActions'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('uni', { showToast: vi.fn() })
})

describe('群成员消息清理范围', () => {
  it('已退群成员可以清理，确认时切换群也只操作原群', async () => {
    const businessId = ref('group-a')
    const purge = { userId: 'member-a', purgedAt: '2026-10-25T10:00:00Z' }
    api.purge.mockResolvedValue(purge)
    const onMessagesPurged = vi.fn()
    const guardSenderInGroup = vi.fn(() => false)
    const actions = createKickActions({ businessId, onMessagesPurged, guardSenderInGroup,
      confirm: async () => { businessId.value = 'group-b'; return true },
    })
    await actions.purgeUserMessages({ senderId: 'member-a' } as ChatMessage)
    expect(api.purge).toHaveBeenCalledWith('group-a', 'member-a')
    expect(onMessagesPurged).toHaveBeenCalledWith('group-a', purge)
    expect(guardSenderInGroup).not.toHaveBeenCalled()
  })

  it.each([true, false])('移除成员时 deleteMessages=%s 只刷新目标群的清理记录', async deleteMessages => {
    api.kick.mockResolvedValue(undefined)
    const onMessagesPurged = vi.fn()
    const actions = createKickActions({ businessId: ref('group-a'), onMessagesPurged,
      guardSenderInGroup: () => true, confirm: async () => true })
    await actions.kickUser({ senderId: 'member-a' } as ChatMessage, deleteMessages)
    expect(api.kick).toHaveBeenCalledWith('group-a', 'member-a', deleteMessages)
    expect(onMessagesPurged).toHaveBeenCalledTimes(deleteMessages ? 1 : 0)
  })

  it('服务器拒绝清理时不更新清理记录', async () => {
    api.purge.mockRejectedValue(new Error('denied'))
    const onMessagesPurged = vi.fn()
    const actions = createKickActions({ businessId: ref('group-a'), onMessagesPurged,
      guardSenderInGroup: () => true, confirm: async () => true })
    await actions.purgeUserMessages({ senderId: 'member-a' } as ChatMessage)
    expect(onMessagesPurged).not.toHaveBeenCalled()
  })
})

