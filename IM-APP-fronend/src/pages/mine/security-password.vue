<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuthGuard } from '@/composables/useAuthGuard'
import {
  takeSecurityPasswordDraft,
  type SecurityPasswordDraft,
  type SecurityPasswordMode,
} from '@/utils/security-password-draft'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()

const mode = ref<SecurityPasswordMode>('set')
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showNew = ref(false)
const showConfirm = ref(false)
const submitting = ref(false)

const navTitle = computed(() => (mode.value === 'set' ? '设置密码' : '重置密码'))

const canSubmit = computed(() => {
  const a = newPassword.value
  const b = confirmPassword.value
  return a.length >= 6 && b.length >= 6 && a === b
})

onLoad(() => {
  const draft: SecurityPasswordDraft | null = takeSecurityPasswordDraft()
  if (!draft) {
    uni.showToast({ title: '请从安全页进入', icon: 'none' })
    setTimeout(() => {
      uni.navigateBack({ fail: () => uni.redirectTo({ url: '/pages/mine/security' }) })
    }, 400)
    return
  }
  mode.value = draft.mode
  oldPassword.value = draft.oldPassword || ''
})

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/index' })
}

function onSubmit() {
  if (submitting.value || !canSubmit.value) return

  if (newPassword.value.length < 6) {
    uni.showToast({ title: '请输入至少 6 位新密码', icon: 'none' })
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    uni.showToast({ title: '两次输入的密码不一致', icon: 'none' })
    return
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar :title="navTitle" @back="goBack" />

    <view class="body">
      <view class="input-box">
        <input
          class="input"
          :password="!showNew"
          placeholder="请输入新密码"
          placeholder-class="input-placeholder"
          v-model="newPassword"
        />
        <view class="eye-btn" @click="showNew = !showNew">
          <image
            class="eye-icon"
            :src="showNew ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
            mode="aspectFit"
          />
        </view>
      </view>

      <view class="input-box">
        <input
          class="input"
          :password="!showConfirm"
          placeholder="请再次输入新密码"
          placeholder-class="input-placeholder"
          v-model="confirmPassword"
        />
        <view class="eye-btn" @click="showConfirm = !showConfirm">
          <image
            class="eye-icon"
            :src="showConfirm ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
            mode="aspectFit"
          />
        </view>
      </view>

      <button
        class="submit-btn"
        :class="{ 'is-active': canSubmit }"
        :disabled="!canSubmit || submitting"
        :loading="submitting"
        @click="onSubmit"
      >
        确认
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
$primary: #0a2fc2;
$text: #212121;
$border: #d8dce6;
$btn-disabled-bg: #c5cddc;

.page {
  min-height: 100vh;
  background: #fff;
  box-sizing: border-box;
}

.body {
  padding: 48rpx 48rpx 32rpx;
  box-sizing: border-box;
}

.input-box {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 8rpx 0 28rpx;
  margin-bottom: 24rpx;
  border: 1rpx solid $border;
  border-radius: 12rpx;
  box-sizing: border-box;
  background: #fff;
}

.input {
  flex: 1;
  min-width: 0;
  height: 96rpx;
  font-size: 30rpx;
  color: $text;
}

.input-placeholder {
  color: #b0b6c3;
  font-size: 30rpx;
}

.eye-btn {
  width: 80rpx;
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.eye-icon {
  width: 44rpx;
  height: 44rpx;
}

.submit-btn {
  width: 100%;
  height: 96rpx;
  margin: 40rpx 0 0;
  padding: 0;
  border: none;
  border-radius: 12rpx;
  background: $btn-disabled-bg !important;
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
