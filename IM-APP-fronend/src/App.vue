<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { setupAppAuthGuard } from '@/composables/useAuthGuard'
import { checkAndPromptAppUpdate } from '@/composables/useAppUpdate'
import { getStatusBarHeight } from '@/utils/status-bar'

onLaunch(() => {
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
})

onShow(() => {
  setupAppAuthGuard()
  void checkAndPromptAppUpdate()
})
</script>

<style lang="scss">
@import '@/styles/common.scss';
</style>
