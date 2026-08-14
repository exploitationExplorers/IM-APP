<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const groupId = ref('')
const nickname = ref('')

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }

  nickname.value = userStore.profile?.nickname || '我'
})

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">我在本群的昵称</text>
      <view class="nav-space" />
    </view>

    <view class="card">
      <text class="label">当前昵称</text>
      <text class="value">{{ nickname }}</text>
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
  font-size: 34rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.nav-space {
  width: 52rpx;
  height: 52rpx;
}

.card {
  background: #fff;
  margin-top: 18rpx;
  padding: 30rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.label {
  font-size: 30rpx;
  color: #666;
}

.value {
  font-size: 30rpx;
  color: #1d1d1d;
  font-weight: 600;
}
</style>
