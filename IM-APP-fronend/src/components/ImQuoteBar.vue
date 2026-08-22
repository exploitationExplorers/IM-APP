<script setup lang="ts">
import { APP_CONFIG } from '@/config'

defineProps<{
  nickname: string
  text: string
  /** 左侧缩略图：引用图片时为图片本身，非媒体时可为头像 */
  thumb?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const fallbackThumb = APP_CONFIG.defaultAvatarUrl
</script>

<template>
  <view class="quote-bar">
    <image class="quote-thumb" :src="thumb || fallbackThumb" mode="aspectFill" />
    <view class="quote-main">
      <text class="quote-name">{{ nickname }}</text>
      <text class="quote-text">{{ text }}</text>
    </view>
    <view class="quote-close" @click="emit('close')">×</view>
  </view>
</template>

<style scoped lang="scss">
.quote-bar {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx 8rpx;
  gap: 16rpx;
  background: #fff;
}

.quote-thumb {
  width: 64rpx;
  height: 64rpx;
  border-radius: 0;
  flex-shrink: 0;
  background: #ddd;
}

.quote-main {
  flex: 1;
  min-width: 0;
}

.quote-name {
  display: block;
  font-size: 24rpx;
  line-height: 34rpx;
  font-weight: 700;
  color: #212121;
}

.quote-text {
  display: block;
  font-size: 24rpx;
  line-height: 34rpx;
  color: #636e86;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.quote-close {
  width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  color: #999;
  flex-shrink: 0;
}
</style>
