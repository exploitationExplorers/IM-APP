<script setup lang="ts">
defineProps<{
  count: number
  mode: 'forward' | 'multi'
  /** 选中项里当前身份能撤回的条数：>0 且多选模式才显示「撤回」 */
  revocableCount?: number
}>()

const emit = defineEmits<{
  cancel: []
  forward: []
  remove: []
  recall: []
}>()
</script>

<template>
  <view class="bar safe-bottom">
    <view class="btn ghost" @click="emit('cancel')">取消</view>
    <view class="btn primary" :class="{ disabled: count === 0 }" @click="emit('forward')">
      转发({{ count }})
    </view>
    <view
      v-if="mode === 'multi' && (revocableCount ?? 0) > 0"
      class="btn danger"
      @click="emit('recall')"
    >
      撤回({{ revocableCount }})
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
  /* 多一个「撤回」按钮后要 4 个并排，gap 从 16rpx 收到 12rpx 给文字留宽度 */
  gap: 12rpx;
  padding: 16rpx 24rpx 24rpx;
  background: #f7f7f7;
  border-top: 1rpx solid #e8e8e8;
}

.btn {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 600;
  /* 撤回(99) 这类文案不允许换行，超宽就截断，别把底栏顶高 */
  white-space: nowrap;
  overflow: hidden;
}

.ghost {
  /* 「取消」不参与均分，把宽度让给三个动作按钮 */
  flex: none;
  padding: 0 24rpx;
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
