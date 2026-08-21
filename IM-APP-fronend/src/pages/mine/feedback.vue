<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()

const MAX_CONTENT = 200
const contact = ref('')
const content = ref('')
const imagePath = ref('')
const submitting = ref(false)

const contentLen = computed(() => content.value.length)
const canSubmit = computed(() => content.value.trim().length > 0 && !submitting.value)

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/mine/general' })
}

function onContentInput(e: Event) {
  const next = ((e as unknown as { detail: { value: string } }).detail.value || '').slice(
    0,
    MAX_CONTENT,
  )
  content.value = next
}

function chooseImage() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const path = res.tempFilePaths?.[0]
      if (path) imagePath.value = path
    },
  })
}

function removeImage() {
  imagePath.value = ''
}

function onSubmit() {
  if (!canSubmit.value) return
  const text = content.value.trim()
  if (!text) {
    uni.showToast({ title: '请输入反馈内容', icon: 'none' })
    return
  }
  submitting.value = true
  uni.showToast({ title: '已送出', icon: 'success' })
  setTimeout(() => {
    submitting.value = false
    goBack()
  }, 500)
}
</script>

<template>
  <view class="page">
    <ImNavBar title="意见反馈" @back="goBack" />

    <view class="body">
      <view class="field">
        <text class="label">联系方式</text>
        <view class="input-box">
          <input
            class="input"
            type="text"
            maxlength="64"
            placeholder="手机号码、邮箱、QQ、微信等"
            placeholder-class="ph"
            v-model="contact"
          />
        </view>
      </view>

      <view class="field">
        <text class="label">反馈内容</text>
        <view class="textarea-box">
          <textarea
            class="textarea"
            :maxlength="MAX_CONTENT"
            placeholder="请输入反馈内容"
            placeholder-class="ph"
            :value="content"
            @input="onContentInput"
          />
        </view>
        <text class="counter">{{ contentLen }}/{{ MAX_CONTENT }}</text>
      </view>

      <view class="field">
        <text class="label">添加图片</text>
        <view v-if="imagePath" class="image-wrap">
          <image class="preview" :src="imagePath" mode="aspectFill" />
          <view class="image-remove" @click="removeImage">
            <text class="image-remove-text">×</text>
          </view>
        </view>
        <view v-else class="add-box" @click="chooseImage">
          <text class="add-plus">+</text>
        </view>
      </view>
    </view>

    <view class="footer">
      <button
        class="submit-btn"
        :class="{ 'is-active': canSubmit }"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        送出
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
$primary: #0a2fc2;
$text: #303133;
$muted: #909399;
$field-bg: #f5f7fa;
$field-border: #e4e7ed;
$btn-disabled: #c5cddc;

.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.body {
  flex: 1;
  padding: 24rpx 40rpx 32rpx;
  box-sizing: border-box;
}

.field {
  margin-bottom: 36rpx;
}

.label {
  display: block;
  font-size: 30rpx;
  color: $text;
  line-height: 44rpx;
  margin-bottom: 16rpx;
}

.input-box,
.textarea-box {
  background: $field-bg;
  border: 1rpx solid $field-border;
  border-radius: 12rpx;
  box-sizing: border-box;
}

.input-box {
  height: 88rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
}

.input {
  flex: 1;
  height: 88rpx;
  font-size: 28rpx;
  color: $text;
}

.textarea-box {
  min-height: 280rpx;
  padding: 20rpx 24rpx;
}

.textarea {
  width: 100%;
  min-height: 240rpx;
  font-size: 28rpx;
  color: $text;
  line-height: 44rpx;
}

.ph {
  color: #c0c4cc;
  font-size: 28rpx;
}

.counter {
  display: block;
  margin-top: 12rpx;
  text-align: right;
  font-size: 24rpx;
  color: #8a93a6;
  line-height: 36rpx;
}

.add-box {
  width: 160rpx;
  height: 160rpx;
  border: 2rpx dashed #c8ced9;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.add-plus {
  font-size: 64rpx;
  color: #a8b0c0;
  line-height: 1;
  font-weight: 300;
}

.image-wrap {
  position: relative;
  width: 160rpx;
  height: 160rpx;
}

.preview {
  width: 160rpx;
  height: 160rpx;
  border-radius: 12rpx;
  display: block;
  background: $field-bg;
}

.image-remove {
  position: absolute;
  top: -12rpx;
  right: -12rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-remove-text {
  color: #fff;
  font-size: 28rpx;
  line-height: 1;
}

.footer {
  padding: 24rpx 40rpx calc(48rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.submit-btn {
  width: 100%;
  height: 96rpx;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 12rpx;
  background: $btn-disabled !important;
  color: #fff !important;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-btn.is-active {
  background: $primary !important;
}

.submit-btn::after {
  border: none;
}

.submit-btn[disabled] {
  opacity: 1;
}
</style>
