import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'

const PUBLIC_PAGES = [
  '/pages/download/index',
  '/pages/auth/sign-in',
  '/pages/auth/sign-up',
  '/pages/auth/forgot-password',
  '/pages/auth/agreement',
  '/pages/auth/privacy',
]

export function useAuthGuard() {
  const userStore = useUserStore()

  async function checkAuth() {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    const route = current ? `/${current.route}` : ''
    if (PUBLIC_PAGES.includes(route)) return
    // 冷启动时 storage 可能还没就绪，先等一次补救读取再判，避免误踢已登录用户
    if (await userStore.restoreSessionIfNeeded()) return
    if (!userStore.isLoggedIn) {
      uni.reLaunch({ url: '/pages/auth/sign-in' })
    }
  }

  onShow(() => {
    void checkAuth()
  })
}

/** 网站根路径还没挂上页面时，不能当成未授权页踢去登录。带具体路由的深链仍走原来的校验。 */
function isH5DownloadEntry(): boolean {
  let entry = false
  // #ifdef H5
  const hash = typeof location === 'undefined' ? '/' : location.hash || '/'
  const path = hash.replace(/^#/, '').split('?')[0]
  entry = path === '' || path === '/' || path === '/pages/download/index'
  // #endif
  return entry
}

export async function setupAppAuthGuard() {
  const userStore = useUserStore()
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  const route = current ? `/${current.route}` : ''
  if (!route && isH5DownloadEntry()) return
  if (PUBLIC_PAGES.includes(route)) return
  if (await userStore.restoreSessionIfNeeded()) return
  if (!userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  }
}
