<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    disabled?: boolean
  }>(),
  {
    modelValue: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'change', value: boolean): void
}>()

function toggle() {
  if (props.disabled) return
  const next = !props.modelValue
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <view
    class="im-switch"
    :class="{ active: props.modelValue, disabled: props.disabled }"
    @click="toggle"
  >
    <view class="im-switch-dot" />
  </view>
</template>

<style scoped>
.im-switch {
  position: relative;
  width: 56rpx;
  height: 36rpx;
  flex: none;
  border-radius: 999rpx;
  background: #e1e5ed;
  box-sizing: border-box;
  transition: background-color 0.2s ease;
}

.im-switch.active {
  background: #153dcc;
}

.im-switch.disabled {
  opacity: 0.45;
}

.im-switch-dot {
  position: absolute;
  left: 4rpx;
  top: 4rpx;
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: #fff;
  box-sizing: border-box;
  box-shadow: 0 1rpx 3rpx rgba(0, 0, 0, 0.08);
  transition: transform 0.2s ease;
}

.im-switch.active .im-switch-dot {
  transform: translateX(20rpx);
}

.im-switch:active {
  opacity: 0.8;
}

.im-switch.disabled:active {
  opacity: 0.45;
}
</style>
