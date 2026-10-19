import type { ChatMessage } from '@/types'
import type { ChatMessageActionsOpts } from './types'

type ChatStorePin = {
  conversations: Array<{
    id: string
    pinnedMessage?: { clientMsgID: string; scope?: string } | null
  }>
  pinChatMessage: (
    convId: string,
    message: ChatMessage,
    scope: 'self' | 'shared',
    nickname: string,
  ) => Promise<void>
  unpinChatMessage: (convId: string, shared: boolean) => Promise<void>
}

export function createPinActions(deps: {
  opts: ChatMessageActionsOpts
  chatStore: ChatStorePin
}) {
  function choosePinScope(): Promise<'self' | 'shared' | null> {
    const isGroup = deps.opts.chatType.value === 'group'
    const canShare = isGroup
      ? deps.opts.myRole.value === 'owner' || deps.opts.myRole.value === 'admin'
      : true
    if (!canShare) return Promise.resolve('self')
    const peerName =
      (deps.opts.peerDisplayName?.value || deps.opts.conversationTitle?.value || '对方').trim() ||
      '对方'
    const sharedLabel = isGroup ? '为全员置顶' : `为我和 ${peerName} 置顶`
    return new Promise((resolve) => {
      uni.showActionSheet({
        itemList: [sharedLabel, '仅为我置顶'],
        success: (res) => {
          if (res.tapIndex === 0) resolve('shared')
          else if (res.tapIndex === 1) resolve('self')
          else resolve(null)
        },
        fail: () => resolve(null),
      })
    })
  }

  async function pinOrUnpinMessage(message: ChatMessage) {
    const convId = deps.opts.conversationId.value
    const current = deps.chatStore.conversations.find((c) => c.id === convId)?.pinnedMessage
    if (current?.clientMsgID === message.id) {
      try {
        await deps.chatStore.unpinChatMessage(convId, current.scope === 'shared')
        uni.showToast({ title: '已取消置顶', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '取消置顶失败', icon: 'none' })
      }
      return
    }
    const scope = await choosePinScope()
    if (!scope) return
    try {
      await deps.chatStore.pinChatMessage(
        convId,
        message,
        scope,
        deps.opts.nicknameOf(message) || message.senderNickname || '',
      )
      uni.showToast({ title: '已置顶', icon: 'none' })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '置顶失败', icon: 'none' })
    }
  }

  return { pinOrUnpinMessage }
}
