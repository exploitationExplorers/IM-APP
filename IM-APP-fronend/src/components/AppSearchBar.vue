<script setup lang="ts">
defineProps<{
  placeholder?: string
  modelValue?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'confirm', v: string): void
  (e: 'click'): void
  (e: 'clear'): void
}>()

function readInputValue(e: Event): string {
  const detail = (e as unknown as { detail?: { value?: string } }).detail?.value
  if (typeof detail === 'string') return detail
  const target = e.target as HTMLInputElement | null
  return typeof target?.value === 'string' ? target.value : ''
}

function onInput(e: Event) {
  emit('update:modelValue', readInputValue(e))
}

/** 点到图标或空白时也要把焦点放进输入框，否则字会继续进到旁边已聚焦的聊天框 */
function onBarClick(e: Event) {
  emit('click')
  const root = e.currentTarget as HTMLElement | null
  const input = root?.querySelector?.('input')
  if (input instanceof HTMLInputElement) input.focus()
}

function onConfirm(e: Event) {
  emit('confirm', readInputValue(e))
}

function onClear() {
  emit('update:modelValue', '')
  emit('clear')
}
</script>

<template>
  <view
    class="search-bar"
    @click="onBarClick"
  >
    <icon
      type="search"
      size="16"
      color="#8a8f9c"
      class="search-icon"
    />
    <input
      class="search-input"
      type="text"
      confirm-type="search"
      :value="modelValue"
      :placeholder="placeholder || '搜索'"
      placeholder-class="search-placeholder"
      @input="onInput"
      @confirm="onConfirm"
    >
    <view
      v-if="modelValue"
      class="clear-btn"
      @click.stop="onClear"
    >
      <text class="clear-x">
        ×
      </text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.search-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
  height: 72rpx;
  padding: 0 24rpx 0 32rpx;
  margin: 16rpx 40rpx;
}

.search-icon {
  color: #626e8d;
  font-size: 30rpx;
  line-height: 1;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #212121;
  height: 72rpx;
  line-height: 72rpx;
  min-width: 0;
}

.search-placeholder {
  color: #626e8d;
}

.clear-btn {
  flex-shrink: 0;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #c4c7cf;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-x {
  color: #fff;
  font-size: 28rpx;
  line-height: 1;
  margin-top: -2rpx;
}
</style>
