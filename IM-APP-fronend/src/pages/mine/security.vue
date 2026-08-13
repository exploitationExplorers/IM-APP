<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { consumeSecuritySaveSuccess } from '@/utils/profile-feedback'
import { stashOldPassword, userHasPassword } from '@/utils/password-state'
import ImSuccessToast from '@/components/ImSuccessToast.vue'

useAuthGuard()
const userStore = useUserStore()
const successVisible = ref(false)
const oldPassword = ref('')
const showOldPassword = ref(false)
const checking = ref(true)

const phoneDisplay = computed(() => {
  const p = userStore.profile
  if (!p) return ''
  const code = (p.countryCode || '+86').replace(/^\+/, '')
  const number = p.phone || p.phoneMasked || ''
  return number ? `${code} ${number}` : code
})

const canNext = computed(() => oldPassword.value.length > 0)

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

function onNext() {
  if (!canNext.value) return
  stashOldPassword(oldPassword.value)
  oldPassword.value = ''
  uni.navigateTo({ url: '/pages/mine/reset-password?mode=change' })
}
</script>

<template>
  <view v-if="!checking" class="page">
    <view class="nav-row">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
    </view>

    <text class="page-title">安全</text>

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
          placeholder-style="color:#636E86"
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

    <view class="footer">
      <button
        class="next-btn"
        :class="{ 'is-enabled': canNext }"
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
$primary: #0a2fc2;
$text: #212121;
$muted: #8a93a6;
$border: #d8dce6;
$btn-disabled-bg: #c5cddc;

.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
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

.phone-block,
.password-block {
  padding: 0 40rpx;
}

.field-label {
  display: block;
  font-size: 28rpx;
  color: #636e86;
  line-height: 40rpx;
}

.field-value {
  display: block;
  margin-top: 8rpx;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
}

.divider {
  height: 1rpx;
  margin: 32rpx 40rpx;
  background: #e1e3ea;
}

.section-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: #212121;
  line-height: 48rpx;
  margin-bottom: 24rpx;
}

.password-block .field-label {
  margin-bottom: 12rpx;
}

.input-box {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 24rpx;
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

.next-btn {
  width: 100%;
  height: 96rpx;
  border: none;
  border-radius: 16rpx;
  background: #eef1f8;
  color: #626e8d;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 96rpx;

  &.is-enabled {
    background: #0a2fc2;
    color: #fff;
  }
}
</style>
