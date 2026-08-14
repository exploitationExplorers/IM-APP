<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'

useAuthGuard()

const appName = APP_CONFIG.displayName
const versionText = ref(APP_CONFIG.version)

onMounted(() => {
  try {
    const info = uni.getSystemInfoSync()
    const raw =
      (info as { appWgtVersion?: string }).appWgtVersion ||
      (info as { appVersion?: string }).appVersion ||
      APP_CONFIG.version
    versionText.value = String(raw).startsWith('v') ? String(raw) : `v${raw}`
  } catch {
    versionText.value = APP_CONFIG.version
  }
})

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/mine/general' })
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">关于我们</text>
      <view class="nav-spacer" />
    </view>

    <view class="content">
      <image class="logo" src="/static/auth/icon-256.png" mode="aspectFit" />
      <text class="name">{{ appName }}</text>
      <text class="version">{{ versionText }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
$text: #212121;

.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.nav {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  height: calc(88rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 24rpx 0;
  box-sizing: border-box;
  background: #fff;
}

.nav-back {
  width: 88rpx;
  height: 88rpx;
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
  color: $text;
}

.nav-spacer {
  width: 88rpx;
  height: 88rpx;
  flex-shrink: 0;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 160rpx;
  box-sizing: border-box;
}

.logo {
  width: 160rpx;
  height: 160rpx;
  border-radius: 28rpx;
  display: block;
  background: #0a2fc2;
}

.name {
  margin-top: 32rpx;
  font-size: 36rpx;
  font-weight: 700;
  color: $text;
  line-height: 52rpx;
}

.version {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #3a4558;
  line-height: 40rpx;
}
</style>
