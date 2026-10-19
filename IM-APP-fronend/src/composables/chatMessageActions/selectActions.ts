import { computed, ref, type Ref } from 'vue'
import type { ChatMessage } from '@/types'
import { useForwardStore } from '@/stores/forward'

export function createSelectActions(deps: {
  conversationId: Ref<string>
  visibleMessages: { value: ChatMessage[] }
  quote: Ref<ChatMessage | null>
  closeMenu: () => void
}) {
  const forwardStore = useForwardStore()
  const selecting = ref(false)
  const selectMode = ref<'forward' | 'multi'>('multi')
  const selectedOrder = ref<string[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const selectedCount = computed(() => selectedIds.value.size)

  function enterSelect(message: ChatMessage, mode: 'forward' | 'multi') {
    selectMode.value = mode
    selecting.value = true
    selectedIds.value = new Set([message.id])
    selectedOrder.value = [message.id]
    deps.closeMenu()
  }

  function toggleSelect(message: ChatMessage) {
    if (!selecting.value) return
    const next = new Set(selectedIds.value)
    const order = selectedOrder.value.filter((id) => id !== message.id)
    if (next.has(message.id)) next.delete(message.id)
    else {
      next.add(message.id)
      order.push(message.id)
    }
    selectedIds.value = next
    selectedOrder.value = order
  }

  function cancelSelect() {
    const wasForward = selectMode.value === 'forward'
    selecting.value = false
    selectedIds.value = new Set()
    selectedOrder.value = []
    if (wasForward) deps.quote.value = null
  }

  function selectedMessages() {
    const byId = new Map(deps.visibleMessages.value.map((m) => [m.id, m]))
    return selectedOrder.value.map((id) => byId.get(id)).filter((m): m is ChatMessage => !!m)
  }

  function goForward(messages: ChatMessage[]) {
    if (!messages.length) return
    forwardStore.start(
      deps.conversationId.value,
      messages.map((m) => m.id),
    )
    uni.navigateTo({ url: '/pages/chat/forward' })
  }

  return {
    selecting,
    selectMode,
    selectedIds,
    selectedCount,
    enterSelect,
    toggleSelect,
    cancelSelect,
    selectedMessages,
    goForward,
  }
}
