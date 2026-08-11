<script setup lang="ts">
defineProps<{
  placeholder?: string
  modelValue?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'confirm', v: string): void
  (e: 'click'): void
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
  <view class="search-bar" @click="emit('click')">
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
  background: #f3f4f7;
  border-radius: 999rpx;
  height: 72rpx;
  padding: 0 28rpx;
  margin: 0 28rpx 8rpx;
}

.search-icon {
  color: #8a8f9c;
  font-size: 30rpx;
  margin-right: 12rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #212121;
}

.search-placeholder {
  color: #8a8f9c;
}
</style>
