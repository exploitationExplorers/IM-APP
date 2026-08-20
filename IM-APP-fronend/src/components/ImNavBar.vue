<script setup lang="ts">
import { getStatusBarHeight } from '@/utils/status-bar'

/**
 * 统一子页面导航栏（全项目唯一实现，App/H5 通用）。
 * - App 端 navigationStyle:custom 页面从屏幕顶端绘制，组件内用 JS 取状态栏高度让出；
 *   不依赖 CSS 变量注入，避免个别基座注入失败导致内容顶进状态栏。
 * - H5 端 statusBarHeight 为 0，样式不受影响。
 * - 布局规范：行高 96rpx、水平 padding 0 32rpx、SVG 返回键、标题 40rpx 居中加粗。
 */
defineProps<{
  title: string
}>()

const emit = defineEmits<{ (e: 'back'): void }>()

const statusBarHeight = getStatusBarHeight()
</script>

<template>
  <view class="im-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="im-nav-row">
      <view class="im-nav-back" @click="emit('back')">
        <image class="im-nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="im-nav-title">{{ title }}</text>
      <view class="im-nav-side">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.im-nav {
  background: #fff;
}

.im-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 32rpx;
}

.im-nav-back {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.im-nav-back-icon {
  width: 44rpx;
  height: 44rpx;
}

.im-nav-title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #212121;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.im-nav-side {
  min-width: 72rpx;
  width: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  gap: 8rpx;
}
</style>
