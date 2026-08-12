<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG, THEME } from '@/config'

useAuthGuard()
const userStore = useUserStore()

const nickname = computed(() => userStore.profile?.nickname || '')
const bio = computed(() => userStore.profile?.bio || '')
const publicId = computed(() => userStore.profile?.publicId || '')
const avatarSrc = computed(
  () => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl,
)

const phoneDisplay = computed(() => {
  const p = userStore.profile
  if (!p) return ''
  const raw = p.countryCode || '+86'
  const code = raw.startsWith('+') ? raw : `+${raw}`
  const number = p.phone || p.phoneMasked || ''
  return number ? `${code} ${number}` : code
})

onMounted(() => {
  if (userStore.isLoggedIn) {
    userStore.loadProfile().catch(() => undefined)
  }
})

function goBack() {
  uni.navigateBack()
}

function goQrcode() {
  uni.navigateTo({ url: '/pages/mine/qrcode' })
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

function onComingSoon(feature: string) {
  uni.showToast({ title: `${feature}功能开发中`, icon: 'none' })
}

function onDeleteAccount() {
  uni.showModal({
    title: '注销帐号',
    content: '注销后帐号数据将无法恢复，确定继续吗？',
    confirmText: '注销',
    confirmColor: THEME.danger,
    success: (res) => {
      if (res.confirm) {
        uni.showToast({ title: '注销功能开发中', icon: 'none' })
      }
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">个人资料</text>
      <view class="nav-spacer" />
    </view>

    <view class="avatar-row" @click="onComingSoon('更换头像')">
      <image class="avatar" :src="avatarSrc" mode="aspectFill" />
      <image class="chevron" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
    </view>

    <view class="section">
      <view class="cell cell-link" @click="onComingSoon('修改昵称')">
        <text class="label">昵称</text>
        <view class="cell-right">
          <text v-if="nickname" class="value">{{ nickname }}</text>
          <image class="chevron" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
        </view>
      </view>
      <view class="cell cell-link" @click="onComingSoon('修改个性签名')">
        <text class="label">个性签名</text>
        <view class="cell-right">
          <text v-if="bio" class="value">{{ bio }}</text>
          <image class="chevron" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
        </view>
      </view>
    </view>

    <view class="divider" />

    <view class="section">
      <view class="cell">
        <text class="label">电话号码</text>
        <text class="value">{{ phoneDisplay }}</text>
      </view>
      <view class="cell cell-link">
        <text class="label">聊天号</text>
        <view class="cell-right">
          <text class="public-id">{{ publicId }}</text>
          <view class="copy-btn" @click.stop="onCopyPublicId">复制</view>
        </view>
      </view>
      <view class="cell cell-link" @click="goQrcode">
        <text class="label">二维码</text>
        <image class="chevron" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
      </view>
    </view>

    <view class="divider" />

    <view class="section">
      <view class="cell cell-link" @click="onDeleteAccount">
        <text class="danger-text">注销帐号</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
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

.avatar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 144rpx;
  padding: 24rpx 40rpx;
  background: #eef1f6;
  box-sizing: border-box;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  flex-shrink: 0;
  background: #fff;
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
