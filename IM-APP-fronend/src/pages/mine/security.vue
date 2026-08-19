<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { consumeSecuritySaveSuccess } from '@/utils/profile-feedback'
import { stashOldPassword, userHasPassword } from '@/utils/password-state'
import { verifyPassword } from '@/api/user'
import ImNavBar from '@/components/ImNavBar.vue'
import ImSuccessToast from '@/components/ImSuccessToast.vue'

useAuthGuard()
const userStore = useUserStore()
const successVisible = ref(false)
const oldPassword = ref('')
const showOldPassword = ref(false)
const checking = ref(true)
const submitting = ref(false)

const phoneDisplay = computed(() => {
  const p = userStore.profile
  if (!p) return ''
  const code = (p.countryCode || '+86').replace(/^\+/, '')
  const number = p.phone || p.phoneMasked || ''
  return number ? `${code} ${number}` : code
})

const hasOldPassword = computed(() => oldPassword.value.length > 0)
const canNext = computed(() => hasOldPassword.value && !submitting.value)

onShow(async () => {
  checking.value = true
  try {
    if (userStore.isLoggedIn) {
      await userStore.loadProfile()
    }
    if (!userHasPassword(userStore.profile)) {
      uni.redirectTo({ url: '/pages/mine/reset-password?mode=init' })
      return
    }
    if (consumeSecuritySaveSuccess()) {
      successVisible.value = true
    }
  } finally {
    checking.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

function onOldPasswordInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  oldPassword.value = detail?.value || ''
}

async function onNext() {
  if (!canNext.value) return
  submitting.value = true
  try {
    await verifyPassword(oldPassword.value)
    stashOldPassword(oldPassword.value)
    oldPassword.value = ''
    uni.navigateTo({ url: '/pages/mine/reset-password?mode=change' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '旧密码不正确', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view v-if="!checking" class="page">
    <ImNavBar title="安全" @back="goBack" />

    <view class="body">
      <view class="phone-block">
        <text class="field-label">手机号码</text>
        <text class="field-value">{{ phoneDisplay }}</text>
      </view>

      <view class="divider" />

      <view class="password-block">
        <text class="section-title">修改密码</text>
        <text class="field-label">旧密码</text>
        <view class="input-box">
          <input
            class="input"
            :password="!showOldPassword"
            :value="oldPassword"
            placeholder="请输入旧密码"
            placeholder-style="color:#626E8D"
            @input="onOldPasswordInput"
          />
          <view class="eye-btn" @click="showOldPassword = !showOldPassword">
            <image
              class="eye-icon"
              :src="showOldPassword ? '/static/auth/icon-eye.svg' : '/static/auth/icon-eye-off.svg'"
              mode="aspectFit"
            />
          </view>
        </view>
      </view>

      <view class="body-spacer" />

      <button
        class="next-btn"
        :class="{ 'is-enabled': hasOldPassword }"
        :disabled="!canNext"
        @click="onNext"
      >
        下一步
      </button>
    </view>

    <ImSuccessToast :visible="successVisible" @close="successVisible = false" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0 40rpx calc(32rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.field-label {
  display: block;
  padding: 16rpx 0;
  font-size: 28rpx;
  line-height: 48rpx;
  color: #212121;
}

.field-value {
  display: block;
  font-size: 28rpx;
  line-height: 48rpx;
  color: #626e8d;
}

.divider {
  height: 1rpx;
  margin: 32rpx 0;
  background: #e1e3ea;
}

.section-title {
  display: block;
  margin-bottom: 16rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #212121;
}

.password-block .field-label {
  padding-top: 0;
}

.input-box {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 32rpx;
  background: #fff;
  border: 1rpx solid rgba(23, 23, 23, 0.2);
  border-radius: 8rpx;
  box-sizing: border-box;
}

.input {
  flex: 1;
  min-width: 0;
  height: 96rpx;
  font-size: 32rpx;
  line-height: 48rpx;
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

.body-spacer {
  flex: 1;
  min-height: 48rpx;
}

.next-btn {
  width: 100%;
  height: 96rpx;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8rpx;
  background: #e1e4ea;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 96rpx;

  &::after {
    border: none;
  }

  &.is-enabled {
    background: #0a2fc2;
  }
}
</style>
