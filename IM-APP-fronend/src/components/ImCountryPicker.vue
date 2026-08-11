<script setup lang="ts">
import { ref } from 'vue'
import { COUNTRY_LIST, findCountryByDialCode, validatePhone } from '@/constants/countries'

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
    <view class="auth-code-box" @click="togglePicker">
      <text class="auth-code-text">{{ modelValue }}</text>
      <image class="auth-code-chevron" src="/static/auth/icon-chevron-down.png" mode="aspectFit" />
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
}

.picker-panel {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  background: #fff;
  border-radius: 12rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.12);
  min-width: 280rpx;
  margin-top: 8rpx;
}

.picker-item {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 24rpx;
  font-size: 26rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.picker-item.active {
  color: #2b5cff;
}

.dial {
  color: #999;
}
</style>
