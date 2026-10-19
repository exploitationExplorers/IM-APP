import type { ChatMessage } from '@/types'
import { createFavorite } from '@/api/favorites'
import { rememberConversationTitle } from '@/utils/favoriteMeta'
import { businessUserIdFromIM } from '@/utils/openim'
import { favoritePayloadOf } from './buildMenuItems'
import { confirm } from './confirm'
import type { ChatMessageActionsOpts } from './types'

export function createFavoriteActions(deps: {
  opts: ChatMessageActionsOpts
  conversationTitleOf: (conversationId: string) => string
}) {
  async function favoriteMessage(message: ChatMessage) {
    if (!(await confirm('确定加入收藏吗？', '加入收藏'))) return
    const { type, content } = favoritePayloadOf(message)
    try {
      await createFavorite({
        messageId: message.id,
        type,
        content,
        senderId: businessUserIdFromIM(message.senderId) || message.senderId,
        conversationId: message.conversationId,
      })
      const convTitle =
        deps.opts.conversationTitle?.value || deps.conversationTitleOf(message.conversationId)
      rememberConversationTitle(message.conversationId, convTitle)
      uni.showToast({ title: '已收藏', icon: 'none' })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '收藏失败', icon: 'none' })
    }
  }

  async function deleteMessages(
    messages: ChatMessage[],
    removeLocalMany: (conversationId: string, ids: string[]) => Promise<void>,
    cancelSelect: () => void,
  ) {
    if (!messages.length) return
    const ok = await confirm(
      messages.length > 1 ? `确定删除这 ${messages.length} 条消息吗？` : '确定删除该消息吗？',
    )
    if (!ok) return
    try {
      await removeLocalMany(
        deps.opts.conversationId.value,
        messages.map((m) => m.id),
      )
      cancelSelect()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' })
    }
  }

  return { favoriteMessage, deleteMessages }
}
