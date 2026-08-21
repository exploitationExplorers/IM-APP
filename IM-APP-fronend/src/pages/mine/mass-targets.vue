<script setup lang="ts">
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import { useMassSendStore } from '@/stores/massSend'

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
    <ImNavBar title="群发对象" @back="goBack" />

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
