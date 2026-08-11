<script setup lang="ts">
import { ref } from 'vue'
import { COUNTRY_LIST, validatePhone } from '@/constants/countries'

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const props = defineProps<{
  modelValue: string
}>()

const showPicker = ref(false)

function selectCountry(dialCode: string) {
  emit('update:modelValue', dialCode)
  showPicker.value = false
}

function togglePicker() {
  showPicker.value = !showPicker.value
}

defineExpose({ validatePhone: (phone: string) => validatePhone(props.modelValue, phone) })
</script>

<template>
  <view class="country-picker">
    <view class="code-box" @click="togglePicker">
      <text class="code-text">{{ modelValue }}</text>
      <text class="code-caret">▾</text>
    </view>
    <view v-if="showPicker" class="picker-panel">
      <view
        v-for="item in COUNTRY_LIST"
        :key="item.code"
        class="picker-item"
        :class="{ active: item.dialCode === modelValue }"
        @click="selectCountry(item.dialCode)"
      >
        <text>{{ item.name }}</text>
        <text class="dial">{{ item.dialCode }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.country-picker {
  position: relative;
  flex-shrink: 0;
}

.code-box {
  width: 160rpx;
  height: 96rpx;
  background: #ffffff;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  box-sizing: border-box;
}

.code-text {
  color: #212121;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1;
}

.code-caret {
  color: #8a8f9c;
  font-size: 20rpx;
  line-height: 1;
}

.picker-panel {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  background: #fff;
  border-radius: 12rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.18);
  min-width: 280rpx;
  margin-top: 8rpx;
  max-height: 480rpx;
  overflow-y: auto;
}

.picker-item {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 24rpx;
  font-size: 26rpx;
  border-bottom: 1rpx solid #f0f0f0;
  color: #212121;
}

.picker-item.active {
  color: #0a2fc2;
}

.dial {
  color: #8a8f9c;
}
</style>
