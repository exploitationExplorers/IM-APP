import { computed, ref, type Ref } from 'vue'
import type { ChatMessage } from '@/types'
import { buildMessageMenuItems } from './buildMenuItems'
import { resolveMenuPoint } from './menuCoords'
import type { ChatMessageActionsOpts, MessageMenuItem } from './types'
import type { createSenderGuards } from './senderGuards'

type Guards = ReturnType<typeof createSenderGuards>

export function createMenuShell(deps: {
  opts: ChatMessageActionsOpts
  guards: Guards
  selecting: Ref<boolean>
  quote: Ref<ChatMessage | null>
  pinnedClientMsgIdOf: (conversationId: string) => string | undefined
}) {
  const menuMessage = ref<ChatMessage | null>(null)
  const menuPosition = ref<{ x: number; y: number } | null>(null)
  const textSelectingId = ref('')
  const quote = deps.quote
  const menuVisible = computed(() => !!menuMessage.value && !deps.selecting.value)

  const menuItems = computed<MessageMenuItem[]>(() => {
    const message = menuMessage.value
    if (!message) return []
    return buildMessageMenuItems({
      message,
      mine: deps.opts.isMine(message),
      isGroup: deps.opts.chatType.value === 'group',
      canManage: deps.guards.canActOnTarget(message),
      canRevoke: deps.guards.canRevoke(message),
      senderInGroup: deps.guards.isSenderInGroup(message),
      muted: !!deps.guards.memberMetaOf(message)?.isMuted,
      pinnedClientMsgId: deps.pinnedClientMsgIdOf(deps.opts.conversationId.value),
    })
  })

  function closeMenu() {
    menuMessage.value = null
    menuPosition.value = null
  }

  function clearTextSelecting() {
    textSelectingId.value = ''
  }

  function openMenu(message: ChatMessage, event?: unknown) {
    if (deps.selecting.value || message.type === 'system') return
    if (textSelectingId.value && textSelectingId.value === message.id) return
    clearTextSelecting()
    menuPosition.value = resolveMenuPoint(event)
    menuMessage.value = message
  }

  function startQuote(message: ChatMessage) {
    quote.value = message
  }

  function clearQuote() {
    quote.value = null
  }

  return {
    menuMessage,
    menuPosition,
    menuVisible,
    menuItems,
    textSelectingId,
    quote,
    closeMenu,
    clearTextSelecting,
    openMenu,
    startQuote,
    clearQuote,
  }
}
