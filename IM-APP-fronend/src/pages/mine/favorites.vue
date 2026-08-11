<script setup lang="ts">
import { ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'

const tab = ref<'all' | 'text' | 'media' | 'file' | 'voice'>('all')
const tabs = [
  { key: 'all' as const, label: '全部' },
  { key: 'text' as const, label: '文字' },
  { key: 'media' as const, label: '图片与视频' },
  { key: 'file' as const, label: '文件' },
  { key: 'voice' as const, label: '语音' },
]
</script>

<template>
  <view class="page">
    <scroll-view scroll-x class="tabs">
      <view
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="tab = t.key"
      >{{ t.label }}</view>
    </scroll-view>
    <EmptyState text="无收藏" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.tabs {
  white-space: nowrap;
  padding: 16rpx 20rpx;
  border-bottom: 1rpx solid #f0f1f4;
}

.tab {
  display: inline-block;
  padding: 12rpx 24rpx;
  margin-right: 8rpx;
  font-size: 28rpx;
  color: #636e86;
}

.tab.active {
  color: #0a2fc2;
  font-weight: 600;
}
</style>
