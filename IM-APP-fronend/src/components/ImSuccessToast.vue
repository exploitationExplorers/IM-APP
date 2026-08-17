<script setup lang="ts">
import { onUnmounted, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    duration?: number
    text?: string
    placement?: 'center' | 'top'
  }>(),
  { duration: 2000, text: '成功', placement: 'center' },
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
  <view v-if="visible" class="toast-wrap" :class="placement">
    <view class="toast">
      <view class="icon">
        <text class="check">✓</text>
      </view>
      <text class="text">{{ text }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.toast-wrap {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.toast-wrap.center {
  top: 0;
  bottom: 0;
  align-items: center;
}

.toast-wrap.top {
  top: 180rpx;
}

.toast {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 28rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 72rpx rgba(0, 0, 0, 0.1);
}

.icon {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #07c160;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check {
  font-size: 24rpx;
  font-weight: 700;
  color: #fff;
  line-height: 1;
}

.text {
  font-size: 28rpx;
  font-weight: 500;
  color: #212121;
  line-height: 40rpx;
}
</style>
