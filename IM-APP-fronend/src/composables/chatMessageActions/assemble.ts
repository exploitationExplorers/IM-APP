import { computed, ref, type Ref } from 'vue'
import type { ChatMessage } from '@/types'
import { useChatStore } from '@/stores/chat'
import { confirm } from './confirm'
import { createFavoriteActions } from './favoriteActions'
import { createKickActions } from './kickActions'
import { createMediaActions } from './mediaActions'
import { createMenuHandlers } from './menuHandlers'
import { createMenuShell } from './menuShell'
import { createMuteAtActions } from './muteAtActions'
import { createPinActions } from './pinActions'
import { createRevokeActions } from './revokeActions'
import { createSelectActions } from './selectActions'
import { createSenderGuards } from './senderGuards'
import type { ChatMessageActionsOpts } from './types'

type AtEntry = { atUserID: string; groupNickname: string }

/** 装配消息菜单会话；入口 composable 只 re-export 结果 */
export function assembleChatMessageActions(opts: ChatMessageActionsOpts) {
  const chatStore = useChatStore()
  const atList = ref<AtEntry[]>([])
  const quote = ref<ChatMessage | null>(null)
  const guards = createSenderGuards(opts)
  let closeMenu: () => void = () => undefined
  const select = createSelectActions({
    conversationId: opts.conversationId,
    visibleMessages: opts.visibleMessages,
    quote,
    closeMenu: () => closeMenu(),
  })
  const menu = createMenuShell({
    opts,
    guards,
    selecting: select.selecting,
    quote,
    pinnedClientMsgIdOf: (id) =>
      chatStore.conversations.find((c) => c.id === id)?.pinnedMessage?.clientMsgID,
  })
  closeMenu = menu.closeMenu
  const parts = createActionParts({ opts, chatStore, atList, guards, select })
  return buildPublicApi(opts, { ...parts, menu, select, quote, atList, guards })
}

function createActionParts(input: {
  opts: ChatMessageActionsOpts
  chatStore: ReturnType<typeof useChatStore>
  atList: Ref<AtEntry[]>
  guards: ReturnType<typeof createSenderGuards>
  select: ReturnType<typeof createSelectActions>
}) {
  const { opts, chatStore, atList, guards, select } = input
  const media = createMediaActions()
  const favorite = createFavoriteActions({
    opts,
    conversationTitleOf: (id) => chatStore.conversations.find((c) => c.id === id)?.title || '',
  })
  const pin = createPinActions({ opts, chatStore })
  const { revokeMessages } = createRevokeActions({
    conversationId: opts.conversationId,
    businessId: opts.businessId,
    selecting: select.selecting,
    isMine: opts.isMine,
    canRevoke: guards.canRevoke,
    cancelSelect: select.cancelSelect,
    recall: (conversationId, messageId, recallOpts) =>
      chatStore.recall(conversationId, messageId, recallOpts),
  })
  const muteAt = createMuteAtActions({
    businessId: opts.businessId,
    myRole: opts.myRole,
    input: opts.input,
    atList,
    publicAtNameOf: opts.publicAtNameOf,
    onMuteChanged: opts.onMuteChanged,
    guardSenderInGroup: guards.guardSenderInGroup,
    confirm,
  })
  const kick = createKickActions({
    businessId: opts.businessId,
    onMuteChanged: opts.onMuteChanged,
    guardSenderInGroup: guards.guardSenderInGroup,
    confirm,
    onMessagesPurged: opts.onMessagesPurged,
  })
  return { media, favorite, pin, revokeMessages, muteAt, kick, chatStore }
}

function buildPublicApi(
  opts: ChatMessageActionsOpts,
  ctx: {
    media: ReturnType<typeof createMediaActions>
    favorite: ReturnType<typeof createFavoriteActions>
    pin: ReturnType<typeof createPinActions>
    revokeMessages: (messages: ChatMessage[]) => Promise<void>
    muteAt: ReturnType<typeof createMuteAtActions>
    kick: ReturnType<typeof createKickActions>
    chatStore: ReturnType<typeof useChatStore>
    menu: ReturnType<typeof createMenuShell>
    select: ReturnType<typeof createSelectActions>
    quote: Ref<ChatMessage | null>
    atList: Ref<AtEntry[]>
    guards: ReturnType<typeof createSenderGuards>
  },
) {
  const deleteMessages = (messages: ChatMessage[]) =>
    ctx.favorite.deleteMessages(
      messages,
      (cid, ids) => ctx.chatStore.removeLocalMany(cid, ids),
      ctx.select.cancelSelect,
    )
  const menuHandlers = createMenuHandlers({
    opts,
    textSelectingId: ctx.menu.textSelectingId,
    enterSelect: ctx.select.enterSelect,
    startQuote: ctx.menu.startQuote,
    copyText: ctx.media.copyText,
    addImageSticker: ctx.media.addImageSticker,
    saveMediaMessage: ctx.media.saveMediaMessage,
    favoriteMessage: ctx.favorite.favoriteMessage,
    pinOrUnpinMessage: ctx.pin.pinOrUnpinMessage,
    deleteMessages,
    revokeMessages: ctx.revokeMessages,
    reportUser: ctx.kick.reportUser,
    atUser: ctx.muteAt.atUser,
    muteUser: ctx.muteAt.muteUser,
    unmuteUser: ctx.muteAt.unmuteUser,
    kickUser: ctx.kick.kickUser,
    purgeUserMessages: ctx.kick.purgeUserMessages,
  })
  async function onMenuSelect(key: string) {
    const message = ctx.menu.menuMessage.value
    ctx.menu.closeMenu()
    if (!message) return
    await menuHandlers[key]?.(message)
  }
  return {
    ...pickMenuFields(ctx),
    ...pickSelectFields(ctx, deleteMessages),
    atList: ctx.atList,
    atUser: ctx.muteAt.atUser,
    atAll: ctx.muteAt.atAll,
    onMenuSelect,
    canRevokeOthers: computed(
      () =>
        opts.chatType.value === 'group' &&
        (opts.myRole.value === 'owner' || opts.myRole.value === 'admin'),
    ),
    forwardMessages: async (messages: ChatMessage[]) => ctx.select.goForward(messages),
    saveVideoMessage: ctx.media.saveVideoMessage,
    isSenderInGroup: ctx.guards.isSenderInGroup,
    notifySenderLeftGroup: ctx.guards.notifySenderLeftGroup,
  }
}

function pickMenuFields(ctx: {
  menu: ReturnType<typeof createMenuShell>
  quote: Ref<ChatMessage | null>
}) {
  return {
    menuVisible: ctx.menu.menuVisible,
    menuItems: ctx.menu.menuItems,
    menuPosition: ctx.menu.menuPosition,
    quote: ctx.quote,
    textSelectingId: ctx.menu.textSelectingId,
    clearTextSelecting: ctx.menu.clearTextSelecting,
    openMenu: ctx.menu.openMenu,
    closeMenu: ctx.menu.closeMenu,
    clearQuote: ctx.menu.clearQuote,
  }
}

function pickSelectFields(
  ctx: {
    select: ReturnType<typeof createSelectActions>
    revokeMessages: (messages: ChatMessage[]) => Promise<void>
  },
  deleteMessages: (messages: ChatMessage[]) => Promise<void>,
) {
  return {
    selecting: ctx.select.selecting,
    selectMode: ctx.select.selectMode,
    selectedIds: ctx.select.selectedIds,
    selectedCount: ctx.select.selectedCount,
    toggleSelect: ctx.select.toggleSelect,
    cancelSelect: ctx.select.cancelSelect,
    onSelectForward: () => ctx.select.goForward(ctx.select.selectedMessages()),
    onSelectDelete: () => {
      void deleteMessages(ctx.select.selectedMessages())
    },
    onSelectRevoke: () => {
      void ctx.revokeMessages(ctx.select.selectedMessages())
    },
  }
}
