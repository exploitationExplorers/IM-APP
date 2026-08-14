<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchQrcode } from '@/api/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { buildQrcodeDataUrl } from '@/utils/qrcode'
import { buildQrcodeCardDataUrl, saveBase64ImageToAlbum } from '@/utils/qrcode-card'
import type { UserQrcodeResult } from '@/types'

useAuthGuard()

const loading = ref(true)
const qrcodeData = ref<UserQrcodeResult | null>(null)
const qrImageUrl = ref('')

const nickname = computed(() => qrcodeData.value?.user.nickname || '')
const avatarUrl = computed(() => qrcodeData.value?.user.avatar || '')
const nicknameInitial = computed(() => (nickname.value ? nickname.value.slice(0, 1) : '?'))
const hasAvatar = computed(() => Boolean(avatarUrl.value))

async function loadQrcode() {
  loading.value = true
  try {
    const data = await fetchQrcode()
    qrcodeData.value = data
    qrImageUrl.value = await buildQrcodeDataUrl(data.payload)
  } catch (e) {
    qrcodeData.value = null
    qrImageUrl.value = ''
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

onShow(() => {
  void loadQrcode()
})

function goBack() {
  uni.navigateBack()
}

function goScan() {
  uni.navigateTo({ url: '/pages/contacts/scan' })
}

async function onShare() {
  if (!qrImageUrl.value) return
  // #ifdef H5
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: `${nickname.value}的二维码`,
        text: '扫一扫加我为好友',
      })
      return
    } catch {
      // 用户取消或不支持文件分享
    }
  }
  // #endif
  uni.setClipboardData({
    data: qrcodeData.value?.payload || '',
    success: () => uni.showToast({ title: '二维码内容已复制', icon: 'none' }),
  })
}

async function onSave() {
  if (!qrImageUrl.value) return
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const cardUrl = await buildQrcodeCardDataUrl({
      nickname: nickname.value,
      nicknameInitial: nicknameInitial.value,
      avatarUrl: avatarUrl.value || undefined,
      qrDataUrl: qrImageUrl.value,
      brandLogoUrl: '/static/auth/logo-full.png',
    })

    // #ifdef H5
    const link = document.createElement('a')
    link.href = cardUrl
    link.download = `${nickname.value || 'qrcode'}.png`
    link.click()
    uni.showToast({ title: '已保存', icon: 'success' })
    return
    // #endif

    // #ifdef APP-PLUS
    await saveBase64ImageToAlbum(cardUrl)
    uni.showToast({ title: '已保存到相册', icon: 'success' })
    return
    // #endif

    uni.showToast({ title: '请长按图片保存', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">二维码</text>
      <view class="nav-actions">
        <view class="nav-action" @click="goScan">
          <image class="nav-action-icon" src="/static/icons/icon-scan.svg" mode="aspectFit" />
        </view>
        <view class="nav-action" @click="onShare">
          <image class="nav-action-icon" src="/static/icons/icon-share.svg" mode="aspectFit" />
        </view>
      </view>
    </view>

    <view class="card">
      <view class="user-row">
        <image
          v-if="hasAvatar"
          class="avatar"
          :src="avatarUrl"
          mode="aspectFill"
        />
        <view v-else class="avatar avatar-fallback">
          <text class="avatar-text">{{ nicknameInitial }}</text>
        </view>
        <text class="nickname">{{ nickname }}</text>
        <image class="brand-logo" src="/static/auth/logo-full.png" mode="aspectFit" />
      </view>

      <view class="qr-wrap">
        <view v-if="loading" class="qr-loading">加载中...</view>
        <image
          v-else-if="qrImageUrl"
          class="qr-image"
          :src="qrImageUrl"
          mode="aspectFit"
          show-menu-by-longpress
        />
        <view v-else class="qr-loading">二维码加载失败</view>
      </view>
    </view>

    <view class="bottom-bar">
      <view class="bottom-action" @click="onSave">
        <image class="bottom-icon" src="/static/icons/icon-download.svg" mode="aspectFit" />
        <text class="bottom-text">保存</text>
      </view>
      <view class="bottom-action" @click="onShare">
        <image class="bottom-icon" src="/static/icons/icon-share.svg" mode="aspectFit" />
        <text class="bottom-text">分享</text>
      </view>
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
  justify-content: space-between;
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
  font-weight: 600;
  color: #212121;
}

.nav-actions {
  width: 144rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
}

.nav-action {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-action-icon {
  width: 44rpx;
  height: 44rpx;
}

.card {
  flex: 1;
  margin: 0;
  background: #fff;
  padding: 32rpx 40rpx 48rpx;
  box-sizing: border-box;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 48rpx;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  flex-shrink: 0;
  background: #eef1f6;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a2fc2;
}

.avatar-text {
  color: #fff;
  font-size: 36rpx;
  font-weight: 600;
}

.nickname {
  flex: 1;
  min-width: 0;
  font-size: 34rpx;
  font-weight: 600;
  color: #212121;
}

.brand-logo {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
}

.qr-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 560rpx;
}

.qr-image {
  width: 560rpx;
  height: 560rpx;
}

.qr-loading {
  color: #636e86;
  font-size: 28rpx;
}

.bottom-bar {
  display: flex;
  align-items: stretch;
  background: #fff;
  border-top: 1rpx solid #e1e3ea;
  padding-bottom: env(safe-area-inset-bottom);
}

.bottom-action {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 28rpx 0;
}

.bottom-icon {
  width: 44rpx;
  height: 44rpx;
}

.bottom-text {
  font-size: 24rpx;
  color: #636e86;
}
</style>
