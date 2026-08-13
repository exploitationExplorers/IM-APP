<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { changePassword } from '@/api/user'
import { markSecuritySaveSuccess } from '@/utils/profile-feedback'
import {
  clearOldPassword,
  consumeOldPassword,
  markUserHasPassword,
} from '@/utils/password-state'

useAuthGuard()

const mode = ref<'init' | 'change'>('init')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const saving = ref(false)

const canSubmit = computed(() => {
  const pwd = password.value
  const confirm = confirmPassword.value
  return pwd.length >= 6 && confirm.length >= 6 && pwd === confirm
})

onLoad((query) => {
  const m = (query as { mode?: string }).mode
  mode.value = m === 'change' ? 'change' : 'init'
})

function goBack() {
  if (mode.value === 'change') {
    clearOldPassword()
  }
  uni.navigateBack()
}

function onPasswordInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  password.value = detail?.value || ''
}

function onConfirmPasswordInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  confirmPassword.value = detail?.value || ''
}

async function onConfirm() {
  if (!canSubmit.value) return
  if (password.value !== confirmPassword.value) {
    uni.showToast({ title: '两次输入的密码不一致', icon: 'none' })
    return
  }

  saving.value = true
  try {
    const oldPassword = mode.value === 'change' ? consumeOldPassword() : undefined
    if (mode.value === 'change' && !oldPassword) {
      uni.showToast({ title: '请重新输入旧密码', icon: 'none' })
      uni.navigateBack()
      return
    }

    await changePassword(password.value, oldPassword)
    markUserHasPassword()
    markSecuritySaveSuccess()

    if (mode.value === 'init') {
      uni.redirectTo({ url: '/pages/mine/security' })
      return
    }
    uni.navigateBack()
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '修改失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav-row">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
    </view>

    <text class="page-title">重置密码</text>

    <view class="form">
      <view class="input-box">
        <input
          class="input"
          :password="!showPassword"
          :value="password"
          placeholder="请输入新密码"
          placeholder-style="color:#636E86"
          @input="onPasswordInput"
        />
        <view class="eye-btn" @click="showPassword = !showPassword">
          <image
            class="eye-icon"
            :src="showPassword ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
            mode="aspectFit"
          />
        </view>
      </view>

      <view class="input-box">
        <input
          class="input"
          :password="!showConfirmPassword"
          :value="confirmPassword"
          placeholder="请再次输入新密码"
          placeholder-style="color:#636E86"
          @input="onConfirmPasswordInput"
        />
        <view class="eye-btn" @click="showConfirmPassword = !showConfirmPassword">
          <image
            class="eye-icon"
            :src="showConfirmPassword ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
            mode="aspectFit"
          />
        </view>
      </view>
    </view>

    <view class="footer">
      <button
        class="confirm-btn"
        :class="{ 'is-enabled': canSubmit }"
        :loading="saving"
        :disabled="!canSubmit || saving"
        @click="onConfirm"
      >
        確認
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.nav-row {
  padding: env(safe-area-inset-top) 24rpx 0;
}

.nav-back {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.nav-back-icon {
  width: 40rpx;
  height: 40rpx;
}

.page-title {
  display: block;
  padding: 8rpx 40rpx 32rpx;
  font-size: 48rpx;
  font-weight: 700;
  color: #212121;
  line-height: 64rpx;
}

.form {
  padding: 0 40rpx;
}

.input-box {
  display: flex;
  align-items: center;
  height: 96rpx;
  margin-bottom: 24rpx;
  padding: 0 24rpx;
  background: #fff;
  border: 1rpx solid #e1e3ea;
  border-radius: 12rpx;
  box-sizing: border-box;
}

.input {
  flex: 1;
  min-width: 0;
  height: 96rpx;
  font-size: 34rpx;
  color: #212121;
}

.eye-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.eye-icon {
  width: 44rpx;
  height: 44rpx;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx 40rpx calc(24rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.confirm-btn {
  width: 100%;
  height: 96rpx;
  border: none;
  border-radius: 16rpx;
  background: #c8ccd6;
  color: #fff;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 96rpx;

  &.is-enabled {
    background: #0a2fc2;
  }
}
</style>
