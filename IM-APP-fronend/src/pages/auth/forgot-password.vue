<script setup lang="ts">
import { ref } from 'vue'
import { resetPassword, sendSmsCode } from '@/api/auth'
import { APP_CONFIG } from '@/config'
import ImCountryPicker from '@/components/ImCountryPicker.vue'
import { findCountryByDialCode, validatePhone } from '@/constants/countries'

const step = ref<1 | 2>(1)
const countryCode = ref(APP_CONFIG.defaultCountryCode)
const phone = ref('')
const code = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function validatePhoneInput() {
  if (!validatePhone(countryCode.value, phone.value)) {
    const c = findCountryByDialCode(countryCode.value)
    uni.showToast({ title: c.placeholder, icon: 'none' })
    return false
  }
  return true
}

async function onSendCode() {
  if (countdown.value > 0) return
  if (!validatePhoneInput()) return
  try {
    const res = await sendSmsCode(phone.value, 'reset')
    uni.showToast({
      title: (res as { tip?: string }).tip || '验证码已发送',
      icon: 'none',
    })
    countdown.value = 60
    timer = setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }, 1000)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onNext() {
  if (!validatePhoneInput()) return
  if (!code.value) {
    uni.showToast({ title: '请输入验证码', icon: 'none' })
    return
  }
  step.value = 2
}

async function onSubmit() {
  if (!password.value || password.value.length < 6) {
    uni.showToast({ title: '请输入至少 6 位新密码', icon: 'none' })
    return
  }
  loading.value = true
  try {
    await resetPassword(phone.value, code.value, password.value)
    uni.showToast({ title: '密码已重置', icon: 'success' })
    setTimeout(() => {
      uni.redirectTo({ url: '/pages/auth/sign-in' })
    }, 500)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (step.value === 2) {
    step.value = 1
    return
  }
  uni.navigateBack({ fail: () => uni.redirectTo({ url: '/pages/auth/sign-in' }) })
}
</script>

<template>
  <view class="auth-page">
    <view class="auth-inner">
      <view class="auth-top-back" @click="goBack">
        <text class="auth-top-back-icon">‹</text>
      </view>

      <image class="auth-logo is-forgot" src="/static/auth/logo.png" mode="aspectFit" />
      <view class="auth-title">{{ step === 1 ? '忘记密码' : '设置新密码' }}</view>

      <view class="auth-form">
        <template v-if="step === 1">
          <view class="auth-row">
            <ImCountryPicker v-model="countryCode" />
            <view class="auth-input-box">
              <input
                class="auth-input"
                type="number"
                maxlength="15"
                :placeholder="findCountryByDialCode(countryCode).placeholder"
                placeholder-style="color:#636E86"
                v-model="phone"
              />
            </view>
          </view>

          <view class="auth-row">
            <view class="auth-input-box">
              <input
                class="auth-input"
                type="number"
                maxlength="6"
                placeholder="请输入验证码"
                placeholder-style="color:#636E86"
                v-model="code"
              />
              <text class="auth-sms-btn" @click="onSendCode">
                {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
              </text>
            </view>
          </view>

          <view class="auth-spacer" />

          <button class="auth-primary-btn" @click="onNext">下一步</button>
        </template>

        <template v-else>
          <view class="auth-row">
            <view class="auth-input-box is-join">
              <input
                class="auth-input"
                :password="!showPassword"
                placeholder="请输入新密码"
                placeholder-style="color:#636E86"
                v-model="password"
              />
              <view class="auth-eye-btn" @click="showPassword = !showPassword">
                <image
                  class="auth-eye-icon"
                  :src="showPassword ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
                  mode="aspectFit"
                />
              </view>
            </view>
          </view>

          <view class="auth-spacer" />

          <button class="auth-primary-btn" :loading="loading" @click="onSubmit">确认重置</button>
        </template>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
@import '@/styles/auth.scss';

.auth-top-back {
  width: 72rpx;
  height: 72rpx;
  margin-top: 24rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.auth-top-back-icon {
  color: #fff;
  font-size: 64rpx;
  font-weight: 300;
  line-height: 1;
}

.auth-logo.is-forgot {
  margin-top: 48rpx;
}
</style>
