<script setup lang="ts">
import { ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { APP_CONFIG } from '@/config'
import ImCountryPicker from '@/components/ImCountryPicker.vue'
import ImLegalConsent from '@/components/ImLegalConsent.vue'
import { useSmsCode } from '@/composables/useSmsCode'
import { findCountryByDialCode } from '@/constants/countries'

const userStore = useUserStore()
const { countdown, send, checkPhone } = useSmsCode('register')
const countryCode = ref(APP_CONFIG.defaultCountryCode)
const phone = ref('')
const code = ref('')
const password = ref('')
const passwordConfirm = ref('')
const showPassword = ref(false)
const showPasswordConfirm = ref(false)
const loading = ref(false)
const agreed = ref(false)

function checkAgreement(): boolean {
  if (agreed.value) return true
  uni.showToast({ title: '请先阅读并同意用户协议与隐私政策', icon: 'none' })
  return false
}

async function onSendCode() {
  if (!checkAgreement()) return
  await send(countryCode.value, phone.value)
}

async function onRegister() {
  if (!checkAgreement()) return
  if (!checkPhone(countryCode.value, phone.value)) return
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

</script>

<template>
  <view class="auth-page is-modern">
    <view class="auth-inner is-sign-up">
      <view
        class="auth-top-back"
        @click="goBack"
      >
        <text class="auth-top-back-icon">
          ‹
        </text>
      </view>

      <image
        class="auth-logo is-sign-up"
        src="/static/logo/logo.png"
        mode="heightFix"
      />
      <view class="auth-title">
        注册
      </view>

      <view class="auth-form">
        <view class="auth-row">
          <ImCountryPicker
            v-model="countryCode"
            minimal
          />
          <view class="auth-input-box">
            <input
              v-model="phone"
              class="auth-input"
              type="number"
              maxlength="15"
              :placeholder="findCountryByDialCode(countryCode).placeholder"
              placeholder-style="color:#636E86"
            >
          </view>
        </view>

        <view class="auth-row">
          <view class="auth-input-box">
            <input
              v-model="code"
              class="auth-input"
              type="number"
              maxlength="6"
              placeholder="请输入验证码"
              placeholder-style="color:#636E86"
            >
            <text
              class="auth-sms-btn"
              @click="onSendCode"
            >
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </text>
          </view>
        </view>

        <view class="auth-row">
          <view class="auth-input-box is-join">
            <input
              v-model="password"
              class="auth-input"
              :password="!showPassword"
              placeholder="设置登录密码（至少 6 位）"
              placeholder-style="color:#636E86"
            >
            <view
              class="auth-eye-btn"
              @click="showPassword = !showPassword"
            >
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
              v-model="passwordConfirm"
              class="auth-input"
              :password="!showPasswordConfirm"
              placeholder="再次确认密码"
              placeholder-style="color:#636E86"
            >
            <view
              class="auth-eye-btn"
              @click="showPasswordConfirm = !showPasswordConfirm"
            >
              <image
                class="auth-eye-icon"
                :src="showPasswordConfirm ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
                mode="aspectFit"
              />
            </view>
          </view>
        </view>

        <ImLegalConsent
          v-model="agreed"
          inverse
        />

        <button
          class="auth-primary-btn"
          :loading="loading"
          @click="onRegister"
        >
          注册
        </button>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
@import '@/styles/auth.scss';
</style>
