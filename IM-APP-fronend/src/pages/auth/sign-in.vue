<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
// import { sendSmsCode } from '@/api/auth' // 验证码登录已隐藏
import { APP_CONFIG } from '@/config'
import ImCountryPicker from '@/components/ImCountryPicker.vue'
import ImNotificationPermissionDialog from '@/components/ImNotificationPermissionDialog.vue'
import { findCountryByDialCode, validatePhone } from '@/constants/countries'
import { readLoginPassword, readLoginPhone, saveLoginPassword, clearLoginPassword } from '@/utils/login-phone'

const userStore = useUserStore()

onShow(() => {
  const saved = readLoginPhone()
  if (saved?.phone && !phone.value) {
    phone.value = saved.phone
    countryCode.value = saved.countryCode || countryCode.value
  }
  const savedPassword = readLoginPassword()
  if (savedPassword && !password.value) {
    password.value = savedPassword
    rememberPassword.value = true
  }
  if (userStore.isLoggedIn) {
    uni.switchTab({ url: '/pages/chat/index' })
  }
})

// 仅保留密码登录；验证码登录 UI/逻辑已注释隐藏（注册、找回密码仍走验证码）
// const mode = ref<'password' | 'sms'>('password')
const countryCode = ref(APP_CONFIG.defaultCountryCode)
const phone = ref('')
const password = ref('')
// const code = ref('')
const showPassword = ref(false)
const rememberPassword = ref(true)
const loading = ref(false)
// const countdown = ref(0)
// let timer: ReturnType<typeof setInterval> | null = null

// function switchMode(next: 'password' | 'sms') {
//   mode.value = next
// }

function validatePhoneInput() {
  if (!validatePhone(countryCode.value, phone.value)) {
    const c = findCountryByDialCode(countryCode.value)
    uni.showToast({ title: c.placeholder, icon: 'none' })
    return false
  }
  return true
}

// function startCountdown(seconds: number) {
//   countdown.value = seconds > 0 ? seconds : 60
//   if (timer) clearInterval(timer)
//   timer = setInterval(() => {
//     countdown.value -= 1
//     if (countdown.value <= 0 && timer) {
//       clearInterval(timer)
//       timer = null
//     }
//   }, 1000)
// }

// async function onSendCode() {
//   if (countdown.value > 0) return
//   if (!validatePhoneInput()) return
//   try {
//     const res = await sendSmsCode(phone.value, 'login', countryCode.value)
//     uni.showToast({ title: '验证码已发送', icon: 'none' })
//     startCountdown(res.retryAfterSec || 60)
//   } catch (e) {
//     uni.showToast({ title: (e as Error).message, icon: 'none' })
//   }
// }

async function onLogin() {
  if (!validatePhoneInput()) return
  if (!password.value) {
    uni.showToast({ title: '请输入密码', icon: 'none' })
    return
  }
  loading.value = true
  try {
    if (rememberPassword.value) saveLoginPassword(password.value)
    else clearLoginPassword()
    await userStore.loginPassword(phone.value, password.value, countryCode.value)
    // if (mode.value === 'password') { ... } else { await userStore.loginSms(...) }
    uni.switchTab({ url: '/pages/chat/index' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goRegister() {
  uni.navigateTo({ url: '/pages/auth/sign-up' })
}

function goForgot() {
  uni.navigateTo({ url: '/pages/auth/forgot-password' })
}
</script>

<template>
  <view class="auth-page">
    <view class="auth-inner">
      <image class="auth-logo" src="/static/logo/logo.png" mode="heightFix" />

      <view class="auth-form">
        <view class="auth-tabs">
          <text class="auth-tab active">账号密码登录</text>
          <!--
          <text
            class="auth-tab"
            :class="{ active: mode === 'password' }"
            @click="switchMode('password')"
          >密码登录</text>
          <text
            class="auth-tab"
            :class="{ active: mode === 'sms' }"
            @click="switchMode('sms')"
          >验证码登录</text>
          -->
        </view>

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
          <view class="auth-input-box is-join">
            <input
              class="auth-input"
              :password="!showPassword"
              placeholder="请输入密码"
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

        <!-- 验证码登录表单项已隐藏
        <view v-else class="auth-row">
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
        -->

        <view class="auth-extra">
          <view class="auth-remember" @click="rememberPassword = !rememberPassword">
            <view class="auth-remember-box" :class="{ on: rememberPassword }">
              <text v-if="rememberPassword" class="auth-remember-tick">✓</text>
            </view>
            <text>记住号码密码</text>
          </view>
          <text class="auth-forgot" @click="goForgot">忘记密码</text>
        </view>

        <view class="auth-spacer" />

        <button class="auth-login-btn" :loading="loading" @click="onLogin">登录</button>
      </view>

      <view class="auth-footer">
        <text class="auth-register-link" @click="goRegister">立即注册</text>
      </view>
    </view>
    <ImNotificationPermissionDialog />
  </view>
</template>

<style lang="scss">
@import '@/styles/auth.scss';
</style>
