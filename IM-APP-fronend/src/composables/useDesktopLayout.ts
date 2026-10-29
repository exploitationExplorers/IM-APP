import { onMounted, onUnmounted, ref, watch } from 'vue'

/** 与参考站 PC 模式一致：宽屏启用三栏布局（H5 + iPad 通用 App） */
export const DESKTOP_BREAKPOINT = 960
export const DESKTOP_SIDEBAR_WIDTH = 72
export const DESKTOP_LIST_WIDTH = 360
/** App 端（iPad 等平板）进入桌面模式的宽度阈值：平板最小宽度 768，iPhone 最大约 430 不会误触发 */
export const DESKTOP_TABLET_BREAKPOINT = 768

function isWeb(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web'
  } catch {
    return typeof window !== 'undefined'
  }
}

/** App 端且为平板（iPad 等）设备才进入桌面模式 */
function isAppTablet(): boolean {
  try {
    const info = uni.getSystemInfoSync() as unknown as Record<string, unknown>
    const platform = info.uniPlatform || info.platform
    // 仅 App 平台（app-plus / ios / android）考虑，其余（web / mp）走各自逻辑
    if (platform !== 'app-plus' && platform !== 'ios' && platform !== 'android') {
      return false
    }
    // 优先用 deviceType 精确判断
    if (info.deviceType === 'pad') return true
    // 退而求其次：窗口/屏幕宽度达到平板阈值
    const getWindowInfo = (uni as unknown as { getWindowInfo?: () => Record<string, unknown> }).getWindowInfo
    const width =
      (getWindowInfo?.()?.windowWidth as number | undefined) ||
      (info.windowWidth as number | undefined) ||
      (info.screenWidth as number | undefined) ||
      0
    return width >= DESKTOP_TABLET_BREAKPOINT
  } catch {
    return false
  }
}

function readDesktop(): boolean {
  if (typeof window === 'undefined') return false
  if (isWeb()) return window.innerWidth >= DESKTOP_BREAKPOINT
  if (isAppTablet()) return true
  return false
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
