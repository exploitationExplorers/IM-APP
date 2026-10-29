<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; inverse?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

function open(kind: 'privacy' | 'agreement') {
  uni.navigateTo({ url: `/pages/auth/${kind}` })
}
</script>

<template>
  <view
    class="legal-consent"
    :class="{ 'is-inverse': props.inverse }"
  >
    <view
      class="legal-check"
      role="checkbox"
      aria-label="同意用户协议和隐私政策"
      :aria-checked="props.modelValue"
      tabindex="0"
      @click="emit('update:modelValue', !props.modelValue)"
      @keydown.enter.prevent="emit('update:modelValue', !props.modelValue)"
      @keydown.space.prevent="emit('update:modelValue', !props.modelValue)"
    >
      <view
        class="legal-box"
        :class="{ 'is-checked': props.modelValue }"
      >
        <view
          v-if="props.modelValue"
          class="legal-tick"
        />
      </view>
    </view>
    <view class="legal-copy">
      <text @click="emit('update:modelValue', !props.modelValue)">
        我已阅读并同意
      </text><text
        class="legal-link"
        @click="open('agreement')"
      >
        《用户协议》
      </text><text>和</text><text
        class="legal-link"
        @click="open('privacy')"
      >
        《隐私政策》
      </text>
    </view>
  </view>
</template>

<style scoped>
.legal-consent { display: flex; align-items: flex-start; gap: 6px; margin: 20px 0; color: #667085; font-size: 12px; line-height: 22px; }
.legal-check { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 24px; height: 24px; margin: -1px 0 -1px -4px; }
.legal-check:focus-visible { border-radius: 50%; outline: 2px solid #2563eb; outline-offset: 2px; }
.legal-box { display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 16px; height: 16px; border: 1px solid #b7c1ce; border-radius: 50%; }
.legal-box.is-checked { border-color: #2563eb; background: #2563eb; }
.legal-tick { width: 4px; height: 7px; margin-top: -2px; border-right: 1.5px solid #fff; border-bottom: 1.5px solid #fff; transform: rotate(45deg); }
.legal-copy { flex: 1; min-width: 0; }
.legal-link { color: #245bd6; font-weight: 400; }
.legal-consent.is-inverse { color: #e2e8f0; }
.is-inverse .legal-link { color: #fff; }
.is-inverse .legal-box { border-color: #d1d9ec; }
.is-inverse .legal-box.is-checked { border-color: #fff; background: #fff; }
.is-inverse .legal-tick { border-color: #0a2fc2; }
.is-inverse .legal-check:focus-visible { outline-color: #fff; }
</style>
