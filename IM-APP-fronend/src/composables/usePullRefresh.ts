import { nextTick, onUnmounted, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'

/**
 * scroll-view 下拉刷新。
 * 首次进入本页、以及 App 从后台回到前台且本页可见时，自动打开放刷新动画（对齐原站 App）。
 */
export function usePullRefresh(loader: () => Promise<unknown>) {
  const refreshing = ref(false)
  let pageVisible = false
  let initialized = false
  let running = false

  async function onRefresherRefresh() {
    if (running) return
    running = true
    refreshing.value = true
    try {
      await loader()
    } finally {
      running = false
      refreshing.value = false
    }
  }

  function triggerRefresh() {
    refreshing.value = false
    void nextTick(() => {
      refreshing.value = true
      void onRefresherRefresh()
    })
  }

  function handleAppShow() {
    if (pageVisible && initialized) triggerRefresh()
  }

  onShow(() => {
    pageVisible = true
    if (!initialized) {
      initialized = true
      triggerRefresh()
      return
    }
    if (running || refreshing.value) return
    void loader()
  })

  onHide(() => {
    pageVisible = false
  })

  uni.onAppShow(handleAppShow)
  onUnmounted(() => {
    uni.offAppShow(handleAppShow)
  })

  return { refreshing, onRefresherRefresh }
}
