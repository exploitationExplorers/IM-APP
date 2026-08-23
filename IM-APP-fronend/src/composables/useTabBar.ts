import { onShow } from '@dcloudio/uni-app'
import { useContactStore } from '@/stores/contact'
import { getToken } from '@/utils/request'

/** 隐藏系统 tabBar，改用自定义底栏对齐参考站 */
export function useTabBar() {
  const contactStore = useContactStore()
  onShow(() => {
    uni.hideTabBar({ animation: false })
    if (getToken()) void contactStore.loadFriendRequests().catch(() => undefined)
  })
}
