<script setup lang="ts">
import { ref } from 'vue'
import { resetPassword, sendSmsCode } from '@/api/auth'
import { APP_CONFIG } from '@/config'
import ImCountryPicker from '@/components/ImCountryPicker.vue'

const countryCode = ref(APP_CONFIG.defaultCountryCode)
const phone = ref('')
const code = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

async function onSendCode() {
  if (countdown.value > 0) return
  if (!/^1\d{10}$/.test(phone.value)) {
    uni.showToast({ title: '请输入正确手机号', icon: 'none' })
    return
  }
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

async function onSubmit() {
  if (!/^1\d{10}$/.test(phone.value)) {
    uni.showToast({ title: '请输入正确手机号', icon: 'none' })
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
  uni.navigateBack({ fail: () => uni.redirectTo({ url: '/pages/auth/sign-in' }) })
}
</script>

<template>
  <view class="auth-page">
    <view class="auth-inner">
      <image class="auth-logo" src="/static/auth/logo.png" mode="aspectFit" />
      <view class="auth-title">忘记密码</view>

      <view class="auth-form">
        <view class="auth-row">
          <ImCountryPicker v-model="countryCode" />
          <view class="auth-input-box">
            <input
              class="auth-input"
              type="number"
              maxlength="11"
              placeholder="请输入手机号码"
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

        <view class="auth-actions">
          <view class="auth-back-btn" @click="goBack">
            <text class="back-chevron">‹</text>
          </view>
          <button class="auth-primary-btn" :loading="loading" @click="onSubmit">确认重置</button>
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
