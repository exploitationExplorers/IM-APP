<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const groupId = ref('')

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">图片与视频</text>
      <view class="nav-space" />
    </view>

    <view class="empty">
      <text>暂无图片与视频</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f5f5;
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 26rpx;
  background: #fff;
}

.nav-back {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.nav-space {
  width: 52rpx;
  height: 52rpx;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 240rpx;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
