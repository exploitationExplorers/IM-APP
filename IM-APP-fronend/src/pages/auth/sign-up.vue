<script setup lang="ts">
import { ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { sendSmsCode } from '@/api/auth'
import { APP_CONFIG } from '@/config'
import ImCountryPicker from '@/components/ImCountryPicker.vue'
import { findCountryByDialCode, validatePhone } from '@/constants/countries'

const userStore = useUserStore()
const countryCode = ref(APP_CONFIG.defaultCountryCode)
const phone = ref('')
const code = ref('')
const password = ref('')
const passwordConfirm = ref('')
const showPassword = ref(false)
const showPasswordConfirm = ref(false)
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

function startCountdown(seconds: number) {
  countdown.value = seconds > 0 ? seconds : 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function onSendCode() {
  if (countdown.value > 0) return
  if (!validatePhoneInput()) return
  try {
    const res = await sendSmsCode(phone.value, 'register', countryCode.value)
    uni.showToast({ title: '验证码已发送', icon: 'none' })
    startCountdown(res.retryAfterSec || 60)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

async function onRegister() {
  if (!validatePhoneInput()) return
  if (!code.value) {
    uni.showToast({ title: '请输入验证码', icon: 'none' })
    return
  }
  if (!password.value || password.value.length < 6) {
    uni.showToast({ title: '请设置至少 6 位密码', icon: 'none' })
    return
  }
  if (password.value !== passwordConfirm.value) {
    uni.showToast({ title: '两次输入的密码不一致', icon: 'none' })
    return
  }
  loading.value = true
  try {
    await userStore.register(phone.value, code.value, password.value, countryCode.value)
    uni.redirectTo({ url: '/pages/auth/onboarding' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack({ fail: () => uni.redirectTo({ url: '/pages/auth/sign-in' }) })
}

function goAgreement() {
  uni.navigateTo({ url: '/pages/auth/agreement' })
}

function goPrivacy() {
  uni.navigateTo({ url: '/pages/auth/privacy' })
}
</script>

<template>
  <view class="auth-page">
    <view class="auth-inner is-sign-up">
      <view class="auth-top-back" @click="goBack">
        <text class="auth-top-back-icon">‹</text>
      </view>

      <image class="auth-logo is-sign-up" src="/static/logo/logo.png" mode="heightFix" />
      <view class="auth-title">注册</view>

      <view class="auth-form">
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

        <view class="auth-row">
          <view class="auth-input-box is-join">
            <input
              class="auth-input"
              :password="!showPassword"
              placeholder="设置登录密码（至少 6 位）"
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

        <view class="auth-row">
          <view class="auth-input-box is-join">
            <input
              class="auth-input"
              :password="!showPasswordConfirm"
              placeholder="再次确认密码"
              placeholder-style="color:#636E86"
              v-model="passwordConfirm"
            />
            <view class="auth-eye-btn" @click="showPasswordConfirm = !showPasswordConfirm">
              <image
                class="auth-eye-icon"
                :src="showPasswordConfirm ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
                mode="aspectFit"
              />
            </view>
          </view>
        </view>

        <view class="auth-spacer" />

        <button class="auth-primary-btn" :loading="loading" @click="onRegister">注册</button>
      </view>

      <view class="auth-agree">
        <text>点击注册代表您已阅读并同意</text>
        <view class="auth-agree-links">
          <text class="auth-agree-link" @click="goAgreement">用户协议</text>
          <text class="auth-agree-link" @click="goPrivacy">隐私权政策</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
@import '@/styles/auth.scss';
</style>
