<script setup lang="ts">
import { ref } from 'vue'

const enterToSend = ref(false)

function onEnterChange(e: Event) {
  enterToSend.value = (e as unknown as { detail: { value: boolean } }).detail.value
}

function onClear() {
  uni.showModal({
    title: '清除聊天记录',
    content: '确定清除全部聊天记录吗？此操作不可恢复。',
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
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">回车键送出消息</text>
      <switch :checked="enterToSend" color="#0A2FC2" @change="onEnterChange" />
    </view>
    <view class="cell" @click="goPlaceholder('群发助手')">
      <text class="label">群发助手</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="goPlaceholder('我的表情')">
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
