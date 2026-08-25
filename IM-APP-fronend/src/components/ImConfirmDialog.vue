<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    content?: string
    cancelText?: string
    confirmText?: string
    showCancel?: boolean
  }>(),
  {
    content: '',
    cancelText: '取消',
    confirmText: '确认',
    showCancel: true,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:visible': [value: boolean]
}>()

function onCancel() {
  emit('cancel')
  emit('update:visible', false)
}

function onConfirm() {
  emit('confirm')
  emit('update:visible', false)
}
</script>

<template>
  <view v-if="visible" class="icd-mask" @touchmove.stop.prevent>
    <view class="icd-card" @click.stop>
      <text class="icd-title">{{ title }}</text>
      <text v-if="content" class="icd-content">{{ content }}</text>
      <view class="icd-actions">
        <view v-if="showCancel" class="icd-cancel" @click="onCancel">
          <text class="icd-cancel-text">{{ cancelText }}</text>
        </view>
        <view class="icd-confirm" @click="onConfirm">
          <text class="icd-confirm-text">{{ confirmText }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.icd-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(16px);
}

.icd-card {
  width: 100%;
  max-width: 620rpx;
  padding: 48rpx 40rpx 32rpx;
  box-sizing: border-box;
  background: #fff;
  border-radius: 24rpx;
  box-shadow: 0 24rpx 64rpx rgba(15, 23, 42, 0.16);
}

.icd-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #212121;
  text-align: left;
}

.icd-content {
  display: block;
  margin-top: 16rpx;
  font-size: 28rpx;
  line-height: 44rpx;
  color: #666;
  text-align: left;
}

.icd-actions {
  margin-top: 40rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
}

.icd-cancel {
  min-width: 120rpx;
  height: 72rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icd-cancel-text {
  font-size: 28rpx;
  line-height: 44rpx;
  color: #0a2fc2;
}

.icd-confirm {
  min-width: 144rpx;
  height: 72rpx;
  padding: 0 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a2fc2;
  border-radius: 12rpx;
}

.icd-confirm:active {
  opacity: 0.85;
}

.icd-cancel:active {
  opacity: 0.6;
}

.icd-confirm-text {
  font-size: 28rpx;
  font-weight: 600;
  line-height: 44rpx;
  color: #fff;
}
</style>
