<script setup lang="ts">
import { computed } from 'vue'
import { useChatSettingsStore } from '@/stores/chatSettings'

const settingsStore = useChatSettingsStore()
const enterToSend = computed(() => settingsStore.enterToSend)

function onEnterChange(e: Event) {
  const v = (e as unknown as { detail: { value: boolean } }).detail.value
  settingsStore.setEnterToSend(!!v)
}

function onClear() {
  uni.showModal({
    title: '清除聊天记录',
    content: '聊天记录只会从此设备中删除，不会从其他人的设备中删除',
    success: (res) => {
      if (res.confirm) {
        uni.showToast({ title: '已清除', icon: 'none' })
      }
    },
  })
}

function goPlaceholder(title: string) {
  uni.showToast({ title: `${title}开发中`, icon: 'none' })
}

function goMassAssistant() {
  uni.navigateTo({ url: '/pages/mine/mass-assistant' })
}

function goEmotions() {
  uni.navigateTo({
    url: '/pages/mine/emotions'
  })
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">回车键送出消息</text>
      <switch :checked="enterToSend" color="#0A2FC2" @change="onEnterChange" style="transform:scale(0.6)" />
    </view>
    <view class="cell" @click="goMassAssistant">
      <text class="label">群发助手</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="goEmotions">
      <text class="label">我的表情</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="onClear">
      <text class="label">清除聊天记录</text>
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
  padding: 20rpx 32rpx;
  // min-height: 96rpx;
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
