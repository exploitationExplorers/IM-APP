import type { Ref } from 'vue'
import type { ChatMessage } from '@/types'

type MenuHandler = (message: ChatMessage) => void | Promise<void>

export function createMenuHandlers(deps: {
  opts: { onRetry?: (message: ChatMessage) => void }
  textSelectingId: Ref<string>
  enterSelect: (message: ChatMessage, mode: 'forward' | 'multi') => void
  startQuote: (message: ChatMessage) => void
  copyText: (message: ChatMessage) => void
  addImageSticker: (message: ChatMessage) => Promise<void>
  saveMediaMessage: (message: ChatMessage) => Promise<void>
  favoriteMessage: (message: ChatMessage) => Promise<void>
  pinOrUnpinMessage: (message: ChatMessage) => Promise<void>
  deleteMessages: (messages: ChatMessage[]) => Promise<void>
  revokeMessages: (messages: ChatMessage[]) => Promise<void>
  reportUser: (message: ChatMessage) => void
  atUser: (message: ChatMessage) => void
  muteUser: (message: ChatMessage) => void
  unmuteUser: (message: ChatMessage) => Promise<void>
  kickUser: (message: ChatMessage, deleteMsgs: boolean) => Promise<void>
  purgeUserMessages: (message: ChatMessage) => Promise<void>
}): Record<string, MenuHandler> {
  return {
    retry: (message) => deps.opts.onRetry?.(message),
    forward: (message) => deps.enterSelect(message, 'forward'),
    quote: (message) => deps.startQuote(message),
    copy: (message) => deps.copyText(message),
    selectText: (message) => {
      deps.textSelectingId.value = message.id
      uni.showToast({ title: '按住文字拖动选择后复制', icon: 'none' })
    },
    sticker: async (message) => {
      if (message.type === 'image') await deps.addImageSticker(message)
    },
    save: async (message) => {
      if (message.type === 'video' || message.type === 'image') await deps.saveMediaMessage(message)
    },
    favorite: (message) => deps.favoriteMessage(message),
    pin: (message) => deps.pinOrUnpinMessage(message),
    delete: (message) => deps.deleteMessages([message]),
    multi: (message) => deps.enterSelect(message, 'multi'),
    revoke: (message) => deps.revokeMessages([message]),
    report: (message) => deps.reportUser(message),
    at: (message) => deps.atUser(message),
    mute: (message) => deps.muteUser(message),
    unmute: (message) => deps.unmuteUser(message),
    kick: (message) => deps.kickUser(message, false),
    kickAndDelete: (message) => deps.kickUser(message, true),
    purgeMessages: (message) => deps.purgeUserMessages(message),
  }
}
