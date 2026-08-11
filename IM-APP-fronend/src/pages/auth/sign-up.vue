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
    const res = await sendSmsCode(phone.value, 'register')
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

async function onRegister() {
  if (!validatePhoneInput()) return
  if (!code.value) {
    uni.showToast({ title: '请输入验证码', icon: 'none' })
    return
  }
  loading.value = true
  try {
    await userStore.register(phone.value, code.value, countryCode.value)
    uni.switchTab({ url: '/pages/chat/index' })
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
    <view class="auth-inner">
      <image class="auth-logo" src="/static/auth/logo.png" mode="aspectFit" />
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

        <view class="auth-spacer" />

        <view class="auth-actions">
          <view class="auth-back-btn" @click="goBack">
            <text class="back-chevron">‹</text>
          </view>
          <button class="auth-primary-btn" :loading="loading" @click="onRegister">注册</button>
        </view>
      </view>

      <view class="auth-agree">
        <text>点击注册代表您已阅读并同意</text>
        <view>
          <text class="auth-agree-link" @click="goAgreement">用户协议</text>
          <text> </text>
          <text class="auth-agree-link" @click="goPrivacy">隐私权政策</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
@import '@/styles/auth.scss';

.back-chevron {
  font-size: 48rpx;
  color: #fff;
  line-height: 1;
  font-weight: 300;
}
</style>
