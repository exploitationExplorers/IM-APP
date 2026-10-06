<script setup lang="ts">
defineProps<{
  count: number
  mode: 'forward' | 'multi'
}>()

const emit = defineEmits<{
  cancel: []
  forward: []
  remove: []
}>()
</script>

<template>
  <view class="bar safe-bottom">
    <view class="btn ghost" @click="emit('cancel')">取消</view>
    <view class="btn primary" :class="{ disabled: count === 0 }" @click="emit('forward')">
      转发({{ count }})
    </view>
    <view
      v-if="mode === 'multi'"
      class="btn danger"
      :class="{ disabled: count === 0 }"
      @click="emit('remove')"
    >
      删除({{ count }})
    </view>
  </view>
</template>

<style scoped lang="scss">
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 24rpx 24rpx;
  background: #f7f7f7;
  border-top: 1rpx solid #e8e8e8;
}

.btn {
  flex: 1;
  height: 72rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;
}

.ghost {
  background: #fff;
  color: #333;
}

.primary {
  background: #0a2fc2;
  color: #fff;
}

.danger {
  background: #fff;
  color: #e54d4d;
}

.disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
