<script setup lang="ts">
import { ref } from 'vue'

const friendVerify = ref(true)
const groupInviteVerify = ref(false)

function onFriendVerify(e: Event) {
  const newValue = (e as unknown as { detail: { value: boolean } }).detail.value
  friendVerify.value = newValue
  
  const isSuccess = Math.random() > 0.3
  if (isSuccess) {
    uni.showToast({
      title: '成功',
      icon: 'success',
      mask: true
    })
  } else {
    uni.showToast({
      title: '失败',
      icon: 'error',
      mask: true
    })
  }
}

function onGroupInviteVerify(e: Event) {
  const newValue = (e as unknown as { detail: { value: boolean } }).detail.value
  groupInviteVerify.value = newValue
  
  const isSuccess = Math.random() > 0.3
  if (isSuccess) {
    uni.showToast({
      title: '成功',
      icon: 'success',
      mask: true
    })
  } else {
    uni.showToast({
      title: '失败',
      icon: 'error',
      mask: true
    })
  }
}

function goBlacklist() {
  uni.navigateTo({
    url: '/pages/mine/blacklist'
  })
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">加我为好友需验证</text>
      <switch :checked="friendVerify" color="#0A2FC2" @change="onFriendVerify" style="transform:scale(0.8)" />
    </view>
    <view class="cell">
      <text class="label">邀请我加入群聊需验证</text>
      <switch :checked="groupInviteVerify" color="#0A2FC2" @change="onGroupInviteVerify" style="transform:scale(0.8)" />
    </view>
    <view class="cell" @click="goBlacklist">
      <text class="label">黑名单</text>
      <text class="arrow">›</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  min-height: 96rpx;
  box-sizing: border-box;
}

.label {
  font-size: 30rpx;
  color: #212121;
}

.arrow {
  color: #c8ccd6;
  font-size: 32rpx;
}
</style>
