import { onShow } from '@dcloudio/uni-app'
import { useContactStore } from '@/stores/contact'
import { getToken } from '@/utils/request'

/** 隐藏系统 tabBar，改用自定义底栏对齐参考站 */
export function useTabBar() {
  const contactStore = useContactStore()
  onShow(() => {
    uni.hideTabBar({ animation: false })
    // 参考站进通讯录会拉 GetFriendApplications；切 Tab / 回前台时同步待处理申请数
    if (getToken()) void contactStore.loadFriendRequests().catch(() => undefined)
  })
}
