import { onMounted, onUnmounted, ref, watch } from 'vue'

/** 与参考站 PC 模式一致：宽屏启用三栏布局（仅 H5） */
export const DESKTOP_BREAKPOINT = 960
export const DESKTOP_SIDEBAR_WIDTH = 72
export const DESKTOP_LIST_WIDTH = 360

function isH5Web(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web'
  } catch {
    return typeof window !== 'undefined'
  }
}

function readDesktop(): boolean {
  if (!isH5Web() || typeof window === 'undefined') return false
  return window.innerWidth >= DESKTOP_BREAKPOINT
}

function syncRootClass(enabled: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('im-desktop', enabled)
}

export function useDesktopLayout() {
  const isDesktop = ref(readDesktop())

  function refresh() {
    isDesktop.value = readDesktop()
    syncRootClass(isDesktop.value)
  }

  onMounted(() => {
    refresh()
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', refresh)
    }
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', refresh)
    }
    syncRootClass(false)
  })

  watch(isDesktop, (enabled) => syncRootClass(enabled), { immediate: true })

  return { isDesktop }
}
