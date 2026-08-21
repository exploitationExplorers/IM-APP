<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import ImNavBar from '@/components/ImNavBar.vue'

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
    <ImNavBar title="关于我们" @back="goBack" />

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
