<script setup lang="ts">
import { ref } from 'vue'

const muteAll = ref(false)
const notifyNew = ref(true)
const soundInApp = ref(true)

function onSwitch(key: 'muteAll' | 'notifyNew' | 'soundInApp', e: Event) {
  const value = (e as unknown as { detail: { value: boolean } }).detail.value
  if (key === 'muteAll') muteAll.value = value
  if (key === 'notifyNew') notifyNew.value = value
  if (key === 'soundInApp') soundInApp.value = value
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">消息免打扰</text>
      <switch :checked="muteAll" color="#0A2FC2" @change="onSwitch('muteAll', $event)" />
    </view>

    <view class="section">应用未打开时</view>
    <view class="cell">
      <text class="label">新消息通知</text>
      <switch :checked="notifyNew" color="#0A2FC2" @change="onSwitch('notifyNew', $event)" />
    </view>

    <view class="section">应用打开时</view>
    <view class="cell">
      <text class="label">声音</text>
      <switch :checked="soundInApp" color="#0A2FC2" @change="onSwitch('soundInApp', $event)" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.section {
  padding: 28rpx 32rpx 8rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #212121;
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
</style>
