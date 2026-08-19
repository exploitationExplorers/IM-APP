<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useChatSettingsStore } from '@/stores/chatSettings'
import {
  canPromptNotificationPermission,
  getNotificationAuthStatus,
  requestNotificationPermission,
} from '@/utils/notification-permission'
import { syncPushRegistration } from '@/utils/push-register'

const visible = ref(false)
const busy = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function syncIfReady() {
  const settings = useChatSettingsStore()
  if (settings.notificationPermissionAsked && settings.message) {
    void syncPushRegistration()
  }
}

function schedule() {
  const settings = useChatSettingsStore()
  settings.hydrate()
  if (settings.notificationPermissionAsked) {
    syncIfReady()
    return
  }
  if (getNotificationAuthStatus() === 'authorized') {
    settings.setNotificationPermissionAsked(true)
    syncIfReady()
    return
  }
  if (!canPromptNotificationPermission()) return
  timer = setTimeout(() => {
    visible.value = true
  }, 360)
}

schedule()

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

async function onConfirm() {
  if (busy.value) return
  busy.value = true
  const settings = useChatSettingsStore()
  settings.setNotificationPermissionAsked(true)
  settings.setMessage(true)
  visible.value = false
  const granted = await requestNotificationPermission()
  if (granted) await syncPushRegistration()
  busy.value = false
}

function onCancel() {
  if (busy.value) return
  const settings = useChatSettingsStore()
  settings.setNotificationPermissionAsked(true)
  settings.setMessage(false)
  visible.value = false
}
</script>

<template>
  <view v-if="visible" class="npd-mask" @touchmove.stop.prevent>
    <view class="npd-card" @click.stop>
      <text class="npd-title">请在以下选择是否接收通知</text>
      <text class="npd-desc">接收通知可以让您在应用程式关闭的情况下，仍然接收到新消息的通知。</text>
      <view class="npd-actions">
        <view class="npd-cancel" @click="onCancel">
          <text class="npd-cancel-text">取消</text>
        </view>
        <view class="npd-confirm" @click="onConfirm">
          <text class="npd-confirm-text">确认</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.npd-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(16px);
}

.npd-card {
  width: 100%;
  max-width: 620rpx;
  padding: 48rpx 40rpx 32rpx;
  box-sizing: border-box;
  background: #fff;
  border-radius: 24rpx;
  box-shadow: 0 24rpx 64rpx rgba(15, 23, 42, 0.16);
}

.npd-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #212121;
  text-align: center;
}

.npd-desc {
  display: block;
  margin-top: 24rpx;
  font-size: 28rpx;
  line-height: 44rpx;
  color: #636e86;
  text-align: center;
}

.npd-actions {
  margin-top: 40rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
}

.npd-cancel {
  min-width: 120rpx;
  height: 72rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.npd-cancel-text {
  font-size: 28rpx;
  line-height: 44rpx;
  color: #636e86;
}

.npd-confirm {
  min-width: 144rpx;
  height: 72rpx;
  padding: 0 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a2fc2;
  border-radius: 12rpx;
}

.npd-confirm:active {
  opacity: 0.85;
}

.npd-cancel:active {
  opacity: 0.6;
}

.npd-confirm-text {
  font-size: 28rpx;
  font-weight: 600;
  line-height: 44rpx;
  color: #fff;
}
</style>
