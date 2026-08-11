import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'

const PUBLIC_PAGES = [
  '/pages/auth/sign-in',
  '/pages/auth/sign-up',
  '/pages/auth/forgot-password',
  '/pages/auth/agreement',
  '/pages/auth/privacy',
]

export function useAuthGuard() {
  const userStore = useUserStore()

  function checkAuth() {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    const route = current ? `/${current.route}` : ''
    if (PUBLIC_PAGES.includes(route)) return
    if (!userStore.isLoggedIn) {
      uni.reLaunch({ url: '/pages/auth/sign-in' })
    }
  }

  onShow(() => {
    checkAuth()
  })
}

export function setupAppAuthGuard() {
  const userStore = useUserStore()
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  const route = current ? `/${current.route}` : ''
  if (!PUBLIC_PAGES.includes(route) && !userStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  }
}
