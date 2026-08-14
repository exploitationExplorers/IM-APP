<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import { uploadAvatarForProfile } from '@/utils/file-upload'

useAuthGuard()
const userStore = useUserStore()

const NICKNAME_MAX = 15

const nickname = ref('')
const avatarPreview = ref('')
const avatarPath = ref('')
const loading = ref(false)

const canSubmit = computed(() => nickname.value.trim().length > 0)
const nicknameCount = computed(() => nickname.value.length)

const avatarSrc = computed(
  () => avatarPreview.value || userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl,
)

onMounted(() => {
  nickname.value = userStore.profile?.nickname || ''
})

function onNicknameInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  nickname.value = (detail?.value || '').slice(0, NICKNAME_MAX)
}

function chooseAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const anyRes = res as unknown as {
        tempFilePaths?: string[] | string
        tempFiles?: Array<{ path?: string; size?: number }>
      }
      const paths = anyRes.tempFilePaths
      const path = Array.isArray(paths) ? paths[0] : paths
      if (!path) return
      avatarPath.value = path
      avatarPreview.value = path
    },
  })
}

async function submitProfile() {
  const name = nickname.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入昵称', icon: 'none' })
    return
  }
  loading.value = true
  try {
    const avatarFileId = await uploadAvatarForProfile(
      avatarPath.value || undefined,
      avatarPath.value ? undefined : APP_CONFIG.defaultAvatarUrl,
    )

    await userStore.saveProfile({
      nickname: name,
      avatarFileId,
      bio: '',
    })
    uni.switchTab({ url: '/pages/chat/index' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function skipLater() {
  uni.switchTab({ url: '/pages/chat/index' })
}
</script>

<template>
  <view class="auth-page onboarding-page">
    <view class="onboarding-inner">
      <text class="onboarding-title">还差一步！</text>
      <text class="onboarding-subtitle">请输入你的个人资料，以完成注册流程</text>

      <view class="avatar-picker" @click="chooseAvatar">
        <image class="avatar-image" :src="avatarSrc" mode="aspectFill" />
        <view class="avatar-badge">
          <image class="avatar-badge-icon" src="/static/auth/icon-camera.svg" mode="aspectFit" />
        </view>
      </view>

      <view class="nickname-block">
        <text class="nickname-label">请输入昵称</text>
        <view class="nickname-input-box">
          <input
            class="nickname-input"
            :value="nickname"
            :maxlength="NICKNAME_MAX"
            placeholder="用户昵称"
            placeholder-style="color:#636E86"
            @input="onNicknameInput"
          />
        </view>
        <view class="nickname-meta">
          <text class="nickname-hint">昵称最多 {{ NICKNAME_MAX }} 个字</text>
          <text class="nickname-count">{{ nicknameCount }}/{{ NICKNAME_MAX }}</text>
        </view>
      </view>

      <view class="onboarding-spacer" />

      <button
        class="onboarding-submit"
        :class="{ 'is-enabled': canSubmit }"
        :loading="loading"
        :disabled="!canSubmit || loading"
        @click="submitProfile"
      >
        立即加入
      </button>

      <text class="onboarding-skip" @click="skipLater">可稍后在个人页面设定头像和昵称</text>
    </view>
  </view>
</template>

<style lang="scss">
@import '@/styles/auth.scss';
</style>

<style scoped lang="scss">
.onboarding-page {
  min-height: 100vh;
}

.onboarding-inner {
  flex: 1;
  width: 100%;
  max-width: 750rpx;
  margin: 0 auto;
  padding: calc(80rpx + env(safe-area-inset-top)) 40rpx calc(40rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.onboarding-title {
  color: #fff;
  font-size: 56rpx;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.onboarding-subtitle {
  margin-top: 24rpx;
  color: rgba(255, 255, 255, 0.92);
  font-size: 28rpx;
  line-height: 1.6;
  text-align: center;
}

.avatar-picker {
  position: relative;
  width: 200rpx;
  height: 200rpx;
  margin: 72rpx auto 64rpx;
}

.avatar-image {
  width: 200rpx;
  height: 200rpx;
  border-radius: 50%;
  background: #fff;
  display: block;
}

.avatar-badge {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12);
}

.avatar-badge-icon {
  width: 36rpx;
  height: 36rpx;
}

.nickname-block {
  width: 100%;
}

.nickname-label {
  display: block;
  color: #fff;
  font-size: 28rpx;
  line-height: 1.4;
  margin-bottom: 16rpx;
}

.nickname-input-box {
  width: 100%;
  height: 96rpx;
  background: #fff;
  border-radius: 8rpx;
  padding: 0 32rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}

.nickname-input {
  flex: 1;
  height: 96rpx;
  font-size: 32rpx;
  color: #212121;
}

.nickname-meta {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nickname-hint,
.nickname-count {
  color: rgba(255, 255, 255, 0.88);
  font-size: 24rpx;
  line-height: 1.4;
}

.onboarding-spacer {
  flex: 1;
  min-height: 48rpx;
}

.onboarding-submit {
  width: 100%;
  height: 96rpx;
  border-radius: 8rpx;
  font-size: 28rpx;
  font-weight: 600;
  border: none;
  margin: 0;
  padding: 0;
  background: rgba(255, 255, 255, 0.28) !important;
  color: rgba(255, 255, 255, 0.55) !important;
}

.onboarding-submit::after {
  border: none;
}

.onboarding-submit.is-enabled {
  background: #ffffff !important;
  color: #0a2fc2 !important;
}

.onboarding-skip {
  margin-top: 32rpx;
  color: rgba(255, 255, 255, 0.92);
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
}
</style>
