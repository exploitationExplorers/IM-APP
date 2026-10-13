<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onShow } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import ImSwitch from '@/components/ImSwitch.vue'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { backToChatHome } from '@/utils/nav'

const settingsStore = useChatSettingsStore()
const { enterToSend } = storeToRefs(settingsStore)

onShow(() => {
  // 进页再对齐一次磁盘，避免「设了过一会开关自己关掉」
  settingsStore.hydrate(true)
})

function onEnterChange(value: boolean) {
  settingsStore.setEnterToSend(!!value)
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

function goMassAssistant() {
  uni.navigateTo({ url: '/pages/mine/mass-assistant' })
}

function goEmotions() {
  uni.navigateTo({
    url: '/pages/mine/emotions',
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar title="聊天设置" @back="backToChatHome" />
    <view class="cell">
      <text class="label">回车键送出消息</text>
      <!-- 不用原生 switch：部分端会在 checked 绑定时误发 change，把已开状态冲成关 -->
      <ImSwitch :model-value="enterToSend" @change="onEnterChange" />
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
