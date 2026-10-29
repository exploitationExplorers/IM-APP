import { computed, readonly, shallowRef } from 'vue'
import { fetchPrivacySettings, updatePrivacySettings } from '@/api/user'
import type { PrivacySettings } from '@/types'

export function usePrivacySettings() {
  // 加载前展示安全默认值，实际值始终以服务端为准。
  const settings = shallowRef<PrivacySettings>({
    requireFriendApproval: true,
    requireGroupApproval: true,
  })
  const loaded = shallowRef(false)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const disabled = computed(() => !loaded.value || loading.value || saving.value)

  async function load() {
    if (loading.value || saving.value) return
    loading.value = true
    loaded.value = false
    try {
      settings.value = await fetchPrivacySettings()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function save(key: keyof PrivacySettings, value: boolean): Promise<boolean> {
    if (disabled.value || settings.value[key] === value) return false
    const previous = settings.value
    const next = { ...previous, [key]: value }
    saving.value = true
    settings.value = next
    try {
      settings.value = await updatePrivacySettings(next)
      return true
    } catch (error) {
      settings.value = previous
      throw error
    } finally {
      saving.value = false
    }
  }

  return { settings: readonly(settings), disabled, load, save }
}
