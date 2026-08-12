<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { markProfileSaveSuccess } from '@/utils/profile-feedback'

useAuthGuard()
const userStore = useUserStore()

const NICKNAME_MAX = 15

const nickname = ref('')
const originalNickname = ref('')
const saving = ref(false)

const nicknameCount = computed(() => nickname.value.length)
const canSubmit = computed(() => {
  const name = nickname.value.trim()
  return name.length > 0 && name !== originalNickname.value.trim()
})

onShow(() => {
  const current = userStore.profile?.nickname || ''
  nickname.value = current
  originalNickname.value = current
  if (userStore.isLoggedIn && !userStore.profile) {
    userStore.loadProfile().catch(() => undefined)
  }
})

function goBack() {
  uni.navigateBack()
}

function onNicknameInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  nickname.value = (detail?.value || '').slice(0, NICKNAME_MAX)
}

function clearNickname() {
  nickname.value = ''
}

async function onConfirm() {
  const name = nickname.value.trim()
  if (!name) {
    uni.showToast({ title: '请输入昵称', icon: 'none' })
    return
  }
  if (name.length > NICKNAME_MAX) {
    uni.showToast({ title: `昵称最多 ${NICKNAME_MAX} 个字`, icon: 'none' })
    return
  }
  if (!canSubmit.value) return

  saving.value = true
  try {
    await userStore.saveProfile({
      nickname: name,
      bio: userStore.profile?.bio || '',
    })
    markProfileSaveSuccess()
    uni.navigateBack()
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">修改昵称</text>
      <view class="nav-spacer" />
    </view>

    <view class="form">
      <view class="input-row">
        <input
          class="input"
          type="text"
          :value="nickname"
          :maxlength="NICKNAME_MAX"
          placeholder="输入昵称"
          placeholder-style="color:#636E86"
          :focus="true"
          @input="onNicknameInput"
        />
        <view v-if="nickname" class="clear-btn" @click="clearNickname">
          <text class="clear-icon">×</text>
        </view>
      </view>
      <view class="meta">
        <text class="hint">昵称最多 {{ NICKNAME_MAX }} 个字</text>
        <text class="count">{{ nicknameCount }}/{{ NICKNAME_MAX }}</text>
      </view>
    </view>

    <view class="footer">
      <button
        class="confirm-btn"
        :class="{ 'is-enabled': canSubmit }"
        :loading="saving"
        :disabled="!canSubmit || saving"
        @click="onConfirm"
      >
        確認
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  height: calc(88rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 24rpx 0;
  background: #fff;
  border-bottom: 1rpx solid #e1e3ea;
  box-sizing: border-box;
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

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #212121;
}

.nav-spacer {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
}

.form {
  padding: 24rpx 40rpx 0;
  background: #fff;
}

.input-row {
  display: flex;
  align-items: center;
  min-height: 96rpx;
  border-bottom: 1rpx solid #e1e3ea;
}

.input {
  flex: 1;
  min-width: 0;
  height: 96rpx;
  font-size: 34rpx;
  color: #212121;
}

.clear-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #c8ccd6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 16rpx;
}

.clear-icon {
  font-size: 32rpx;
  line-height: 1;
  color: #fff;
  margin-top: -2rpx;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0 24rpx;
}

.hint,
.count {
  font-size: 24rpx;
  color: #636e86;
  line-height: 32rpx;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx 40rpx calc(24rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.confirm-btn {
  width: 100%;
  height: 96rpx;
  border: none;
  border-radius: 16rpx;
  background: #c8ccd6;
  color: #fff;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 96rpx;

  &.is-enabled {
    background: #0a2fc2;
  }
}
</style>
