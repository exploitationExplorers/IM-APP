import { defineStore } from 'pinia'
import { ref } from 'vue'

type ChatSettingsState = {
  enterToSend: boolean
}

const STORAGE_KEY = 'im_chat_settings_v1'

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const useChatSettingsStore = defineStore('chatSettings', () => {
  const enterToSend = ref(false)

  let hydrated = false
  function hydrate() {
    if (hydrated) return
    hydrated = true
    const raw = uni.getStorageSync(STORAGE_KEY)
    const parsed = safeParse<ChatSettingsState>(typeof raw === 'string' ? raw : null)
    enterToSend.value = !!parsed?.enterToSend
  }

  function persist() {
    const payload: ChatSettingsState = { enterToSend: enterToSend.value }
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(payload))
  }

  function setEnterToSend(v: boolean) {
    enterToSend.value = v
    persist()
  }

  hydrate()

  return {
    enterToSend,
    hydrate,
    persist,
    setEnterToSend,
  }
})
