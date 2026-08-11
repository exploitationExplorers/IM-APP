<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { setupAppAuthGuard } from '@/composables/useAuthGuard'

onLaunch(() => {
  const userStore = useUserStore()
  userStore.bootstrap()
})

onShow(() => {
  setupAppAuthGuard()
})
</script>

<style lang="scss">
@import '@/styles/common.scss';
</style>
