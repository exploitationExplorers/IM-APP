<script setup lang="ts">
defineProps<{
  nickname: string
  text: string
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <view class="quote-bar">
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
  padding: 12rpx 24rpx 0;
  gap: 16rpx;
}

.quote-main {
  flex: 1;
  min-width: 0;
  padding: 12rpx 20rpx;
  background: #ececec;
  border-radius: 12rpx;
}

.quote-name {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
  color: #333;
  margin-bottom: 4rpx;
}

.quote-text {
  display: block;
  font-size: 24rpx;
  color: #666;
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
}
</style>
