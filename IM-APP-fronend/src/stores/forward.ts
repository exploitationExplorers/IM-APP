import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useForwardStore = defineStore('forward', () => {
  const sourceConversationId = ref('')
  const messageIds = ref<string[]>([])

  function start(conversationId: string, ids: string[]) {
    sourceConversationId.value = conversationId
    messageIds.value = [...new Set(ids)]
  }

  function clear() {
    sourceConversationId.value = ''
    messageIds.value = []
  }

  return {
    sourceConversationId,
    messageIds,
    start,
    clear,
  }
})
