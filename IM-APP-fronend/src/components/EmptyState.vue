<script setup lang="ts">
defineProps<{
  text?: string
}>()
</script>

<template>
  <view class="empty">
    <text class="empty-text">{{ text || '暂无内容' }}</text>
  </view>
</template>

<style scoped lang="scss">
.empty {
  padding: 120rpx 40rpx;
  display: flex;
  justify-content: center;
}

.empty-text {
  color: #999;
  font-size: 28rpx;
}
</style>
