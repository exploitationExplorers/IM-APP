<script setup lang="ts">
import { ref } from 'vue'

const friendVerify = ref(false)
const groupInviteVerify = ref(false)

function onFriendVerify(e: Event) {
  friendVerify.value = (e as unknown as { detail: { value: boolean } }).detail.value
}

function onGroupInviteVerify(e: Event) {
  groupInviteVerify.value = (e as unknown as { detail: { value: boolean } }).detail.value
}

function goBlacklist() {
  uni.showToast({ title: '黑名单开发中', icon: 'none' })
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">加我为好友需验证</text>
      <switch :checked="friendVerify" color="#0A2FC2" @change="onFriendVerify" />
    </view>
    <view class="cell">
      <text class="label">邀请我加入群聊需验证</text>
      <switch :checked="groupInviteVerify" color="#0A2FC2" @change="onGroupInviteVerify" />
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
