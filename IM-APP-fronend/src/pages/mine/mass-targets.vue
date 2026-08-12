<script setup lang="ts">
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useMassSendStore } from '@/stores/massSend'

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
const massStore = useMassSendStore()

const targets = computed(() => massStore.selectedTargets)
const countText = computed(() => `共${targets.value.length}人`)

onShow(() => {
  if (!targets.value.length) {
    uni.showToast({ title: '请先选择联系人', icon: 'none' })
    uni.redirectTo({ url: '/pages/mine/mass-select-contacts' })
  }
})

function goBack() {
  uni.navigateBack()
}

function goEdit() {
  uni.navigateTo({ url: '/pages/mine/mass-select-contacts?from=targets' })
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
          <text class="title">群发对象</text>
        </view>
        <!-- <view class="nav-right">
          <view class="edit-btn" @click="goEdit">编辑</view>
        </view> -->
      </view>
    </view>

    <view class="summary">
      <text class="summary-title">你将发送消息给</text>
      <text class="summary-count">{{ countText }}</text>
    </view>

    <scroll-view scroll-y class="list">
      <view v-for="t in targets" :key="t.id" class="item">
        <image class="avatar" :src="t.avatar" mode="aspectFill" />
        <view class="info">
          <text class="name">{{ t.name }}</text>
          <text class="sub">{{ t.type }}</text>
        </view>
      </view>
      <view v-if="!targets.length" class="empty">暂无群发对象</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #ffffff;
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

.nav-right {
  justify-content: flex-end;
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

.edit-btn {
  height: 56rpx;
  padding: 0 18rpx;
  border-radius: 999rpx;
  background: #f0f1f4;
  color: #111;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.summary {
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f1f4;
}

.summary-title {
  font-size: 26rpx;
  color: #8a8f9c;
}

.summary-count {
  margin-left: 16rpx;
  font-size: 26rpx;
  color: #111;
  font-weight: 600;
}

.list {
  flex: 1;
  background: #ffffff;
}

.item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 20rpx 32rpx;
  border-bottom: 1rpx solid #f2f3f6;
}

.avatar {
  width: 84rpx;
  height: 84rpx;
  border-radius: 50%;
  background: #f3f4f7;
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.name {
  font-size: 30rpx;
  color: #111;
  font-weight: 600;
}

.sub {
  margin-top: 6rpx;
  font-size: 24rpx;
  color: #8a8f9c;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  color: #8a8f9c;
  font-size: 26rpx;
}
</style>
