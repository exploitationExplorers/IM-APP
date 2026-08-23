<script setup lang="ts">
/**
 * 群聊头像长按：对齐参考站的 @TA action-sheet（仅「@TA / 取消」两档）。
 * 按钮文案固定为 @TA；真正写入输入框的是调用方传入的昵称。
 */
defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  at: []
  cancel: []
}>()
</script>

<template>
  <view v-if="visible" class="sheet-root" @touchmove.stop.prevent>
    <view class="mask" @click="emit('cancel')" />
    <view class="panel safe-bottom">
      <view class="card">
        <view class="btn" @click="emit('at')">
          <text class="btn-text">@TA</text>
        </view>
        <view class="divider" />
        <view class="btn" @click="emit('cancel')">
          <text class="btn-text">取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}

.panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx 32rpx 32rpx;
}

.card {
  background: #fff;
  border-radius: 24rpx;
  overflow: hidden;
  box-shadow: 0 16rpx 72rpx rgba(0, 0, 0, 0.16);
}

.btn {
  height: 104rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn:active {
  background: #f5f6f8;
}

.btn-text {
  font-size: 32rpx;
  color: #0a2fc2;
  font-weight: 400;
}

.divider {
  height: 1rpx;
  background: #f0f1f4;
  margin: 0 24rpx;
}
</style>
