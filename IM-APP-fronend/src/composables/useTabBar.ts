import { onShow } from '@dcloudio/uni-app'

/** 隐藏系统 tabBar，改用自定义底栏对齐参考站 */
export function useTabBar() {
  onShow(() => {
    uni.hideTabBar({ animation: false })
  })
}
