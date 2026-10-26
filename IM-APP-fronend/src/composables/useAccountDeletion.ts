import { computed, shallowRef } from 'vue'
import { fetchAccountDeletionRequirements } from '@/api/auth'
import { useUserStore } from '@/stores/user'

export function useAccountDeletion() {
  const password = shallowRef('')
  const acknowledged = shallowRef(false)
  const loading = shallowRef(false)
  const deleting = shallowRef(false)
  const ownedGroupCount = shallowRef(0)
  const requirementsLoaded = shallowRef(false)
  const error = shallowRef('')
  const canSubmit = computed(() => requirementsLoaded.value && !loading.value && !deleting.value
    && ownedGroupCount.value === 0 && acknowledged.value && !!password.value)

  async function load() {
    if (loading.value || deleting.value) return
    loading.value = true
    requirementsLoaded.value = false
    error.value = ''
    try {
      const result = await fetchAccountDeletionRequirements()
      if (!Number.isInteger(result.ownedGroupCount) || result.ownedGroupCount < 0
        || result.canDelete !== (result.ownedGroupCount === 0)) {
        throw new Error('检查结果无效，请重试')
      }
      ownedGroupCount.value = result.ownedGroupCount
      requirementsLoaded.value = true
    } catch (e) {
      error.value = (e as Error).message || '检查失败，请重试'
    } finally {
      loading.value = false
    }
  }

  async function submit() {
    if (!canSubmit.value) return
    // 在弹窗打开时即锁定，防止连续点击重复提交。
    deleting.value = true
    try {
      const confirmed = await new Promise<boolean>(resolve => uni.showModal({
        title: '确定永久注销账号？', content: '注销后无法恢复，所有设备将退出登录。',
        confirmText: '确认注销', confirmColor: '#e5484d',
        success: result => resolve(result.confirm), fail: () => resolve(false),
      }))
      if (!confirmed) return
      error.value = ''
      await useUserStore().deleteAccount(password.value)
    } catch (e) {
      error.value = (e as Error).message || '注销失败，请稍后重试'
    } finally {
      password.value = ''
      deleting.value = false
    }
  }

  return { password, acknowledged, loading, deleting, ownedGroupCount, requirementsLoaded,
    error, canSubmit, load, submit }
}
