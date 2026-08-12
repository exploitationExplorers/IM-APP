<script setup lang="ts">
import { searchUserByPublicId, fetchUserProfile } from '@/api/user'

function goBack() {
  uni.navigateBack()
}

function goMyQrcode() {
  uni.navigateTo({ url: '/pages/mine/qrcode' })
}

function openScanResult(publicId: string) {
  uni.navigateTo({
    url: `/pages/contacts/scan-result?publicId=${encodeURIComponent(publicId)}`,
  })
}

async function resolveDemoUser() {
  // H5 / Mock：相册无法真识码，用可搜到的示例聊天号演示成功页
  const candidates = ['chat10002', 'chat10003', 'chat10004']
  for (const id of candidates) {
    try {
      const user = await searchUserByPublicId(id)
      if (user) {
        openScanResult(user.publicId)
        return
      }
    } catch {
      // try next
    }
  }
  try {
    const user = await fetchUserProfile('u_1')
    openScanResult(user.publicId)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '未识别到有效二维码', icon: 'none' })
  }
}

function chooseFromAlbum() {
  uni.chooseImage({
    count: 1,
    sourceType: ['album'],
    success: () => {
      void resolveDemoUser()
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="back-btn" @click="goBack">
      <image class="back-icon" src="/static/icons/icon-back-white.svg" mode="aspectFit" />
    </view>

    <view class="scan-area">
      <view class="scan-frame" @longpress="resolveDemoUser" />
      <text class="hint">将二维码放入框内，即可自动扫描</text>
    </view>

    <view class="actions">
      <view class="action" @click="goMyQrcode">
        <image class="action-icon" src="/static/icons/icon-qrcode-white.svg" mode="aspectFit" />
        <text class="action-text">我的二维码</text>
      </view>
      <view class="action" @click="chooseFromAlbum">
        <image class="action-icon" src="/static/icons/icon-album-white.svg" mode="aspectFit" />
        <text class="action-text">从相册选取</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: linear-gradient(326deg, #2f9de2 6.61%, #1c41c7 35.26%, #0c1b54 93.13%);
  display: flex;
  flex-direction: column;
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
}

.back-btn {
  position: absolute;
  left: 32rpx;
  top: calc(16rpx + env(safe-area-inset-top));
  z-index: 20;
  width: 96rpx;
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-icon {
  width: 48rpx;
  height: 48rpx;
}

.scan-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 56rpx;
  position: relative;
  z-index: 10;
}

.scan-frame {
  width: 70vw;
  height: 70vw;
  max-width: 526rpx;
  max-height: 526rpx;
  border: 8rpx solid #fff;
  border-radius: 48rpx;
  background: transparent;
  box-sizing: border-box;
  box-shadow: 0 0 1px 100vw rgba(0, 0, 0, 0.5);
}

.hint {
  margin-top: 40rpx;
  color: #fff;
  font-size: 28rpx;
  line-height: 40rpx;
  text-align: center;
  position: relative;
  z-index: 11;
}

.actions {
  position: relative;
  z-index: 20;
  display: flex;
  justify-content: space-evenly;
  padding: 48rpx 80rpx;
  padding-bottom: calc(64rpx + env(safe-area-inset-bottom));
}

.action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  min-width: 140rpx;
}

.action-icon {
  width: 48rpx;
  height: 48rpx;
}

.action-text {
  color: #fff;
  font-size: 28rpx;
  line-height: 40rpx;
}
</style>
