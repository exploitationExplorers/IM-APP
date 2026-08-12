<script setup lang="ts">
import { onUnmounted, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    duration?: number
  }>(),
  { duration: 2000 },
)

const emit = defineEmits<{ close: [] }>()

let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (show) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (show) {
      timer = setTimeout(() => emit('close'), props.duration)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <view v-if="visible" class="toast-wrap">
    <view class="toast">
      <view class="icon">
        <text class="check">✓</text>
      </view>
      <text class="text">成功</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.toast-wrap {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 40rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
}

.icon {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check {
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
  line-height: 1;
}

.text {
  font-size: 32rpx;
  font-weight: 600;
  color: #212121;
  line-height: 44rpx;
}
</style>
