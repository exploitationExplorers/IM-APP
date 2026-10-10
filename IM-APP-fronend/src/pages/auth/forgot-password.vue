<script setup lang="ts">
import { ref } from 'vue'
import { resetPassword } from '@/api/auth'
import { APP_CONFIG } from '@/config'
import ImCountryPicker from '@/components/ImCountryPicker.vue'
import { useSmsCode } from '@/composables/useSmsCode'
import { findCountryByDialCode } from '@/constants/countries'
import { clearLoginPassword, saveLoginPhone } from '@/utils/login-phone'

const step = ref<1 | 2>(1)
const { countdown, send, checkPhone } = useSmsCode('reset')
const countryCode = ref(APP_CONFIG.defaultCountryCode)
const phone = ref('')
const code = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)

function validatePhoneInput() {
  return checkPhone(countryCode.value, phone.value)
}

async function onSendCode() {
  await send(countryCode.value, phone.value)
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
    await resetPassword(phone.value, code.value, password.value, countryCode.value)
    // 旧密码已作废：清掉「记住密码」里存的那份，否则登录页会把老密码自动填回去。
    // 手机号留着，重置完直接登录不用再输一遍。
    clearLoginPassword()
    saveLoginPhone(countryCode.value, phone.value)
    uni.showToast({ title: '密码已重置', icon: 'success' })
    setTimeout(() => {
      uni.redirectTo({ url: '/pages/auth/sign-in' })
    }, 500)
  } catch (e) {
    const message = (e as Error).message || '重置失败'
    uni.showToast({ title: message, icon: 'none' })
    // 第二步没有重发验证码的入口，验证码过期/填错时用户只能卡在这里，退回第一步
    if (message.includes('验证码')) {
      code.value = ''
      step.value = 1
    }
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

      <image class="auth-logo is-forgot" src="/static/logo/logo.png" mode="heightFix" />
      <view class="auth-title">{{ step === 1 ? '忘记密码' : '设置新密码' }}</view>
      <view v-if="step === 2" class="forgot-hint">验证码已发送至 {{ countryCode }} {{ phone }}</view>

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

.auth-logo.is-forgot {
  margin-top: 48rpx;
}

.forgot-hint {
  margin-top: 16rpx;
  text-align: center;
  font-size: 26rpx;
  color: #636e86;
}
</style>
