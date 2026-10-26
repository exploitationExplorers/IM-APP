<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import { playableMediaUrl } from '@/utils/chatMedia'
import {
  pickLocalImages,
  uploadAvatarFile,
  uploadAvatarForProfile,
} from '@/utils/file-upload'
import { consumeProfileSaveSuccess } from '@/utils/profile-feedback'
import ImSuccessToast from '@/components/ImSuccessToast.vue'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()
const userStore = useUserStore()
const successVisible = ref(false)
const avatarFailed = ref(false)

const nickname = computed(() => userStore.profile?.nickname || '')
const bio = computed(() => userStore.profile?.bio || '')
const publicId = computed(() => userStore.profile?.publicId || '')
const avatarSrc = computed(() => {
  if (avatarFailed.value) return APP_CONFIG.defaultAvatarUrl
  return playableMediaUrl(userStore.profile?.avatar || '') || APP_CONFIG.defaultAvatarUrl
})

watch(
  () => userStore.profile?.avatar,
  () => {
    avatarFailed.value = false
  },
)

const phoneDisplay = computed(() => {
  const p = userStore.profile
  if (!p) return ''
  const raw = p.countryCode || '+86'
  const code = raw.startsWith('+') ? raw : `+${raw}`
  const number = p.phone || p.phoneMasked || ''
  return number ? `${code} ${number}` : code
})

onShow(() => {
  if (userStore.isLoggedIn) {
    userStore.loadProfile().catch(() => undefined)
  }
  if (consumeProfileSaveSuccess()) {
    successVisible.value = true
  }
})

function showSaveSuccess() {
  successVisible.value = true
}

function goBack() {
  uni.navigateBack()
}

function goQrcode() {
  uni.navigateTo({ url: '/pages/mine/qrcode' })
}

function goEditNickname() {
  uni.navigateTo({ url: '/pages/mine/edit-nickname' })
}

function goEditBio() {
  uni.navigateTo({ url: '/pages/mine/edit-bio' })
}

function goEditChatId() {
  uni.navigateTo({ url: '/pages/mine/edit-chat-id' })
}

function onCopyPublicId() {
  if (!publicId.value) {
    uni.showToast({ title: '暂无聊天号', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: publicId.value,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}

function onAvatarError() {
  avatarFailed.value = true
}

function isBrowserFile(value: unknown): value is File {
  // iOS App JSCore 无全局 File，裸写 instanceof File 会直接抛 Can't find variable: File
  return typeof File !== 'undefined' && value instanceof File
}

async function uploadPickedAvatar(pathOrFile: string | File) {
  uni.showLoading({ title: '上传中…' })
  try {
    const fileId = isBrowserFile(pathOrFile)
      ? await uploadAvatarFile(pathOrFile)
      : await uploadAvatarForProfile(String(pathOrFile), undefined)
    await userStore.saveProfile({
      nickname: nickname.value || '我',
      avatarFileId: fileId,
      bio: bio.value || '',
    })
    showSaveSuccess()
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '上传失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function onChooseAvatar() {
  // iOS Safari 不认 uni.chooseImage 临时路径，必须在点击里同步打开文件选择
  if (typeof document !== 'undefined' && uni.getSystemInfoSync().uniPlatform === 'web') {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) void uploadPickedAvatar(file)
    }
    input.click()
    return
  }
  void pickLocalImages({ count: 1, sourceType: ['album', 'camera'] })
    .then((paths) => {
      const path = paths[0]
      if (!path) {
        uni.showToast({ title: '未获取到图片，请重试', icon: 'none' })
        return
      }
      void uploadPickedAvatar(path)
    })
    .catch((e) => {
      if (String((e as Error)?.message || '') === 'cancel') return
      uni.showToast({ title: (e as Error)?.message || '无法打开相册', icon: 'none' })
    })
}

// 注销有前置检查（群主等阻碍项）、短信验证与二次确认，流程较长，走独立页面
function onDeleteAccount() {
  uni.navigateTo({ url: '/pages/mine/account-deletion' })
}
</script>

<template>
  <view class="page">
    <ImNavBar
      title="个人资料"
      @back="goBack"
    />

    <view
      class="avatar-row"
      @click="onChooseAvatar"
    >
      <view class="avatar-wrap">
        <image
          :key="avatarSrc"
          class="avatar"
          :src="avatarSrc"
          mode="aspectFill"
          @error="onAvatarError"
        />
      </view>
      <image
        class="chevron"
        src="/static/mine/icon-chevron.svg"
        mode="aspectFit"
      />
    </view>

    <view class="section">
      <view
        class="cell cell-link"
        @click="goEditNickname"
      >
        <text class="label">
          昵称
        </text>
        <view class="cell-right">
          <text
            v-if="nickname"
            class="value"
          >
            {{ nickname }}
          </text>
          <image
            class="chevron"
            src="/static/mine/icon-chevron.svg"
            mode="aspectFit"
          />
        </view>
      </view>
      <view
        class="cell cell-link"
        @click="goEditBio"
      >
        <text class="label">
          个性签名
        </text>
        <view class="cell-right">
          <text
            v-if="bio"
            class="value"
          >
            {{ bio }}
          </text>
          <image
            class="chevron"
            src="/static/mine/icon-chevron.svg"
            mode="aspectFit"
          />
        </view>
      </view>
    </view>

    <view class="divider" />

    <view class="section">
      <view class="cell">
        <text class="label">
          电话号码
        </text>
        <text class="value">
          {{ phoneDisplay }}
        </text>
      </view>
      <view
        class="cell cell-link"
        @click="goEditChatId"
      >
        <text class="label">
          聊天号
        </text>
        <view class="cell-right">
          <text class="public-id">
            {{ publicId }}
          </text>
          <view
            class="copy-btn"
            @click.stop="onCopyPublicId"
          >
            复制
          </view>
          <image
            class="chevron"
            src="/static/mine/icon-chevron.svg"
            mode="aspectFit"
          />
        </view>
      </view>
      <view
        class="cell cell-link"
        @click="goQrcode"
      >
        <text class="label">
          二维码
        </text>
        <image
          class="chevron"
          src="/static/mine/icon-chevron.svg"
          mode="aspectFit"
        />
      </view>
    </view>

    <view class="divider" />

    <view class="section">
      <view
        class="cell cell-link"
        @click="onDeleteAccount"
      >
        <text class="danger-text">
          注销帐号
        </text>
      </view>
    </view>

    <ImSuccessToast
      :visible="successVisible"
      @close="successVisible = false"
    />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
}

.avatar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 144rpx;
  padding: 24rpx 40rpx;
  background: #eef1f6;
  box-sizing: border-box;
}

.avatar-wrap {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: #d8dde8;
}

.avatar {
  width: 100%;
  height: 100%;
  display: block;
}

.section {
  background: #fff;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  padding: 20rpx 40rpx;
  box-sizing: border-box;
  gap: 24rpx;
}

.cell-link:active {
  background: #f7f8fa;
}

.cell-right {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
}

.label {
  flex-shrink: 0;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
}

.value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 34rpx;
  color: #626e8d;
  line-height: 48rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.public-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 32rpx;
  color: #626e8d;
  line-height: 48rpx;
}

.copy-btn {
  flex-shrink: 0;
  padding: 4rpx 16rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 44rpx;
  border-radius: 8rpx;
}

.chevron {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.divider {
  height: 16rpx;
  background: #f3f4f7;
}

.danger-text {
  font-size: 32rpx;
  color: #dc2828;
  line-height: 48rpx;
}
</style>
