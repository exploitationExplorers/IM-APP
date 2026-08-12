<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import EmptyState from '@/components/EmptyState.vue'

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20

const tab = ref<'all' | 'text' | 'media' | 'file' | 'voice'>('all')
const tabs = [
  { key: 'all' as const, label: '全部' },
  { key: 'text' as const, label: '文字' },
  { key: 'media' as const, label: '图片与视频' },
  { key: 'file' as const, label: '文件' },
  { key: 'voice' as const, label: '语音' },
]

const pickMode = ref(false)

onLoad((query) => {
  if (query && query.mode === 'pick') {
    pickMode.value = true
  }
})

function goBack() {
  uni.navigateBack()
}

function selectFavorite(item: unknown) {
  if (!pickMode.value) return
  const pages = getCurrentPages()
  if (pages.length >= 2) {
    const prev = pages[pages.length - 2] as unknown as {
      $vm?: { onFavoritePicked?: (item: unknown) => void }
    }
    if (prev?.$vm?.onFavoritePicked) {
      prev.$vm.onFavoritePicked(item)
    }
  }
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav-bar-wrap">
      <view class="status-bar" :style="{ height: statusBarHeight + 'px' }"></view>
      <view class="nav-bar">
        <view class="nav-left">
          <text class="back-icon" @click="goBack">‹</text>
        </view>
        <view class="nav-center">
          <text class="title">我的收藏</text>
        </view>
        <view class="nav-right"></view>
      </view>
    </view>

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
  display: flex;
  flex-direction: column;
}

.nav-bar-wrap {
  background: #ffffff;
}

.nav-bar {
  height: 96rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  box-sizing: border-box;
}

.nav-left,
.nav-right {
  width: 160rpx;
  display: flex;
  align-items: center;
}

.nav-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.back-icon {
  font-size: 52rpx;
  color: #111;
  line-height: 1;
  padding: 8rpx 12rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.tabs {
  white-space: nowrap;
  padding: 8rpx 20rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
  background: #fff;
}

.tab {
  display: inline-block;
  padding: 20rpx 24rpx;
  margin-right: 8rpx;
  font-size: 30rpx;
  color: #636e86;
  position: relative;
}

.tab.active {
  color: #0a2fc2;
  font-weight: 600;
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 24rpx;
  right: 24rpx;
  bottom: 0;
  height: 4rpx;
  background: #0a2fc2;
  border-radius: 2rpx;
}
</style>
