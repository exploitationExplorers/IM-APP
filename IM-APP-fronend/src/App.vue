<script setup lang="ts">
import { watch } from 'vue'
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'
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
import { isApp } from '@/utils/platform'
import { imSyncing, setIMBackgroundStatus } from '@/utils/openim'

/**
 * 前后台通知只在真正跨过边界时发一次。
 * iOS 的 onShow/onHide 会被重复触发（弹权限框、控制中心、来电都会走一遍），
 * 反复通知 core 会反复唤醒 / 挂起同步，大账号看起来就像「切回来又从 0 开始同步」。
 */
let imInBackground = false

/**
 * 首次大账号同步要跑几分钟，这期间保持屏幕常亮：
 * 自动锁屏会把 App 打到后台，iOS 会冻结进程，同步被打断后下次打开只能重来。
 * 同步结束（或超时看门狗触发）立即恢复系统设置。
 */
let screenAwake = false
watch(imSyncing, (syncing) => {
  if (!isApp() || syncing === screenAwake) return
  screenAwake = syncing
  try {
    uni.setKeepScreenOn({ keepScreenOn: syncing })
  } catch {
    /* 部分基座不支持，忽略即可 */
  }
})

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
  // 告知 SDK 已回前台：core 会唤醒数据补拉（iOS 后台冻结后靠这个恢复同步）。
  // 只在真的从后台回来时发一次，避免重复唤醒把进行中的同步重置。
  if (imInBackground) {
    imInBackground = false
    setIMBackgroundStatus(false)
  }
  if (getToken()) {
    void useContactStore().loadFriendRequests().catch(() => undefined)
    // 回到前台补拉：漏掉推送时靠这一步自愈（内部有 3 秒节流）
    void useChatStore().resyncAfterResume()
  }
})

onHide(() => {
  if (imInBackground) return
  imInBackground = true
  // 告知 SDK 进后台：iOS 挂起前把状态落给长连接管理器，避免回前台后同步状态错乱
  setIMBackgroundStatus(true)
})
</script>

<style lang="scss">
@import '@/styles/common.scss';
@import '@/styles/desktop.scss';
</style>
