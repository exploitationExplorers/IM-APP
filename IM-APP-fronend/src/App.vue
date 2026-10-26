<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useChatStore } from '@/stores/chat'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useContactStore } from '@/stores/contact'
import { setupAppAuthGuard } from '@/composables/useAuthGuard'
import { checkAndPromptAppUpdate } from '@/composables/useAppUpdate'
import { getStatusBarHeight } from '@/utils/status-bar'
import { getToken, setAuthExpiredHandler } from '@/utils/request'
import { warmMediaCache } from '@/utils/mediaCache'
import { initPerfMonitoring } from '@/utils/perf'
import { clearLoginPassword } from '@/utils/login-phone'
import { clearOldPassword } from '@/utils/password-state'

onLaunch(() => {
  setAuthExpiredHandler(() => {
    useUserStore().invalidateSession()
  })
  clearLoginPassword()
  clearOldPassword()
  initPerfMonitoring()
  warmMediaCache()
  const userStore = useUserStore()
  userStore.bootstrap()
  // H5 没有 App 那套 CSS 变量注入；写上也不影响，App 端无 document 会跳过
  const height = `${getStatusBarHeight()}px`
  try {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--status-bar-height', height)
    }
  } catch {
    /* App 端由运行时注入 */
  }
  void checkAndPromptAppUpdate()

  // H5：标签页切回前台时补拉一次。
  // 新消息只靠 OpenIM 推送进 UI，标签页被浏览器节流/断网期间漏掉的推送没有任何补拉机制，
  // 那一端会永久停在旧数据上（电脑端「看不到新消息」）。App.vue 的 onShow 在 H5 下不可靠，
  // 所以显式监听 visibilitychange。App 端仍由下面的 onShow 覆盖。
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      useChatSettingsStore().hydrate(true)
      if (getToken()) {
        void useChatStore().resyncAfterResume()
      }
    })
  }
})

onShow(() => {
  void setupAppAuthGuard()
  void checkAndPromptAppUpdate()
  // 回前台对齐聊天偏好（回车发送等），避免内存态被冲掉后开关自己变回去
  useChatSettingsStore().hydrate(true)
  if (getToken()) {
    void useContactStore().loadFriendRequests().catch(() => undefined)
    // 回到前台补拉：漏掉推送时靠这一步自愈（内部有 3 秒节流）
    void useChatStore().resyncAfterResume()
  }
})
</script>

<style lang="scss">
@import '@/styles/common.scss';
@import '@/styles/desktop.scss';
</style>
