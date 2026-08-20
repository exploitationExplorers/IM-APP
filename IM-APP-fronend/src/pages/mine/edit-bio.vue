<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { markProfileSaveSuccess } from '@/utils/profile-feedback'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()
const userStore = useUserStore()

const BIO_MAX = 50

const bio = ref('')
const originalBio = ref('')
const saving = ref(false)

const bioCount = computed(() => bio.value.length)
const canSubmit = computed(() => bio.value !== originalBio.value)

onShow(() => {
  const current = userStore.profile?.bio || ''
  bio.value = current
  originalBio.value = current
  if (userStore.isLoggedIn && !userStore.profile) {
    userStore.loadProfile().catch(() => undefined)
  }
})

function goBack() {
  uni.navigateBack()
}

function onBioInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  bio.value = (detail?.value || '').slice(0, BIO_MAX)
}

function clearBio() {
  bio.value = ''
}

async function onConfirm() {
  if (!canSubmit.value) return

  saving.value = true
  try {
    await userStore.saveProfile({
      nickname: userStore.profile?.nickname || '我',
      bio: bio.value.slice(0, BIO_MAX),
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
    <ImNavBar title="修改个性签名" @back="goBack" />

    <view class="form">
      <view class="input-row">
        <textarea
          class="textarea"
          :value="bio"
          :maxlength="BIO_MAX"
          placeholder="请输入个性签名"
          placeholder-style="color:#636E86"
          :focus="true"
          auto-height
          @input="onBioInput"
        />
        <view v-if="bio" class="clear-btn" @click="clearBio">
          <text class="clear-icon">×</text>
        </view>
      </view>
      <view class="meta">
        <text class="hint">个性签名最多 {{ BIO_MAX }} 个字</text>
        <text class="count">{{ bioCount }}/{{ BIO_MAX }}</text>
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

.form {
  padding: 24rpx 40rpx 0;
  background: #fff;
}

.input-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding-bottom: 16rpx;
  border-bottom: 1rpx solid #e1e3ea;
}

.textarea {
  flex: 1;
  min-width: 0;
  min-height: 160rpx;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
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
  margin-top: 8rpx;
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
