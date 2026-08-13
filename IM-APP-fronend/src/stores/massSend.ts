import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Contact, GroupPreview } from '@/types'

type MassTargetType = 'contact' | 'group' | 'tag'

export interface MassTarget {
  id: string
  type: MassTargetType
  name: string
  avatar: string
}

export type MassContentType = 'text' | 'image' | 'audio' | 'file' | 'favorite'

export interface MassContent {
  type: MassContentType
  text?: string
  images?: string[]
  imageNames?: string[]
  filePath?: string
  fileName?: string
  audioPath?: string
  audioDuration?: number
}

export interface MassSendRecord {
  id: string
  createdAt: number
  targets: MassTarget[]
  content: MassContent
}

const STORAGE_KEY = 'im_mass_send_history_v1'

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const useMassSendStore = defineStore('massSend', () => {
  const selectedTargets = ref<MassTarget[]>([])
  const draftText = ref('')
  const history = ref<MassSendRecord[]>([])

  const selectedNames = computed(() => selectedTargets.value.map((t) => t.name))

  function hydrate() {
    const raw = uni.getStorageSync(STORAGE_KEY)
    const parsed = safeParse<MassSendRecord[]>(typeof raw === 'string' ? raw : null)
    history.value = Array.isArray(parsed) ? parsed : []
  }

  function persist() {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(history.value))
  }

  function resetDraft() {
    draftText.value = ''
  }

  function resetAll() {
    selectedTargets.value = []
    resetDraft()
  }

  function setSelectedTargets(list: MassTarget[]) {
    selectedTargets.value = list
  }

  function setSelectedFromContacts(list: Contact[]) {
    selectedTargets.value = list.map((c) => ({
      id: c.id,
      type: 'contact',
      name: c.remark || c.nickname,
      avatar: c.avatar,
    }))
  }

  function setSelectedFromGroups(list: GroupPreview[]) {
    selectedTargets.value = list.map((g) => ({
      id: g.id,
      type: 'group',
      name: g.name,
      avatar: g.avatar,
    }))
  }

  function removeSelected(id: string) {
    selectedTargets.value = selectedTargets.value.filter((t) => t.id !== id)
  }

  function send(content: MassContent) {
    const record: MassSendRecord = {
      id: `mass_${Date.now()}`,
      createdAt: Date.now(),
      targets: [...selectedTargets.value],
      content,
    }

    history.value = [record, ...history.value]
    persist()
    resetDraft()
    return record
  }

  function clearHistory() {
    history.value = []
    persist()
  }

  function removeRecords(ids: string[]) {
    if (!ids.length) return
    history.value = history.value.filter((r) => !ids.includes(r.id))
    persist()
  }

  return {
    selectedTargets,
    selectedNames,
    draftText,
    history,
    hydrate,
    persist,
    resetDraft,
    resetAll,
    setSelectedTargets,
    setSelectedFromContacts,
    setSelectedFromGroups,
    removeSelected,
    send,
    clearHistory,
    removeRecords,
  }
})
