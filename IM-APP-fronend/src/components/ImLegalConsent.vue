<script setup lang="ts">
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

function open(kind: 'privacy' | 'agreement') {
  uni.navigateTo({ url: `/pages/auth/${kind}` })
}
</script>

<template>
  <view class="legal-consent">
    <view
      class="legal-check"
      role="checkbox"
      :aria-checked="props.modelValue"
      @click="emit('update:modelValue', !props.modelValue)"
    >
      <text>{{ props.modelValue ? '☑' : '☐' }} 我已阅读并同意</text>
    </view>
    <text
      class="legal-link"
      @click="open('agreement')"
    >
      《用户协议》
    </text>
    <text
      class="legal-link"
      @click="open('privacy')"
    >
      《隐私政策》
    </text>
  </view>
</template>

<style scoped>
.legal-consent { display: flex; flex-wrap: wrap; justify-content: center; gap: 12rpx; margin: 32rpx 0; font-size: 26rpx; line-height: 44rpx; color: #636e86; }
.legal-check { padding: 8rpx 0; }
.legal-link { color: #0a2fc2; padding: 8rpx 0; }
</style>
