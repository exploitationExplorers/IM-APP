import { onShow } from '@dcloudio/uni-app'
import { useContactStore } from '@/stores/contact'
import { useUserStore } from '@/stores/user'
import { getToken } from '@/utils/request'

/** 隐藏系统 tabBar，改用自定义底栏对齐参考站 */
export function useTabBar() {
  const contactStore = useContactStore()
  const userStore = useUserStore()
  onShow(() => {
    uni.hideTabBar({ animation: false })
    const token = userStore.token || getToken()
    if (token) void contactStore.loadFriendRequests().catch(() => undefined)
  })
}
