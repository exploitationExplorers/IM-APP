<script setup lang="ts">
const props = defineProps<{ modelValue: string[]; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>()
const limit = 9

function addImages() {
  if (props.disabled || props.modelValue.length >= limit) return
  uni.chooseImage({
    count: limit - props.modelValue.length,
    sourceType: ['album', 'camera'],
    sizeType: ['compressed'],
    success: (result) => {
      if (props.disabled) return
      const paths = Array.isArray(result.tempFilePaths) ? result.tempFilePaths : [result.tempFilePaths]
      emit('update:modelValue', [...new Set([...props.modelValue, ...paths.filter(Boolean)])].slice(0, limit))
    },
  })
}

function remove(index: number) {
  if (!props.disabled) emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
}

function preview(path: string) {
  uni.previewImage({ current: path, urls: props.modelValue })
}
</script>

<template>
  <view class="evidence">
    <text class="evidence-title">
      证据截图（选填，最多 9 张）
    </text>
    <view class="evidence-images">
      <view
        v-for="(path, index) in props.modelValue"
        :key="path"
        class="evidence-image"
      >
        <image
          class="evidence-thumb"
          :src="path"
          mode="aspectFill"
          @click="preview(path)"
        />
        <text
          v-if="!props.disabled"
          class="evidence-remove"
          @click="remove(index)"
        >
          ×
        </text>
      </view>
      <button
        v-if="props.modelValue.length < limit"
        class="evidence-add"
        :disabled="props.disabled"
        @click="addImages"
      >
        +
      </button>
    </view>
  </view>
</template>

<style scoped>
.evidence { padding: 24rpx; }
.evidence-title { font-size: 28rpx; color: #636e86; }
.evidence-images { display: flex; flex-wrap: wrap; gap: 20rpx; margin-top: 24rpx; }
.evidence-image { position: relative; width: 140rpx; height: 140rpx; }
.evidence-thumb { width: 100%; height: 100%; border-radius: 8rpx; }
.evidence-remove { position: absolute; right: 0; top: 0; color: #fff; background: #636e86; padding: 0 10rpx; }
.evidence-add { width: 140rpx; height: 140rpx; line-height: 140rpx; font-size: 50rpx; margin: 0; }
</style>
