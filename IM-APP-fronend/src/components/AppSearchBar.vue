<script setup lang="ts">
defineProps<{
  placeholder?: string
  modelValue?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'confirm', v: string): void
}>()

function onInput(e: Event) {
  const value = (e as unknown as { detail: { value: string } }).detail?.value ?? ''
  emit('update:modelValue', value)
}

function onConfirm(e: Event) {
  const value = (e as unknown as { detail: { value: string } }).detail?.value ?? ''
  emit('confirm', value)
}
</script>

<template>
  <view class="search-bar">
    <text class="search-icon">⌕</text>
    <input
      class="search-input"
      type="text"
      confirm-type="search"
      :value="modelValue"
      :placeholder="placeholder || '搜索'"
      placeholder-class="search-placeholder"
      @input="onInput"
      @confirm="onConfirm"
    />
  </view>
</template>

<style scoped lang="scss">
.search-bar {
  display: flex;
  align-items: center;
  background: #f2f2f2;
  border-radius: 16rpx;
  height: 72rpx;
  padding: 0 24rpx;
  margin: 0 24rpx 16rpx;
}

.search-icon {
  color: #999;
  font-size: 32rpx;
  margin-right: 12rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #333;
}

.search-placeholder {
  color: #999;
}
</style>
