<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import { checkAndPromptAppUpdate, readLocalAppVersion } from '@/composables/useAppUpdate'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()

const appName = APP_CONFIG.displayName
const versionText = ref(APP_CONFIG.version)
const checking = ref(false)

async function refreshVersion() {
  try {
    const local = await readLocalAppVersion()
    const name = local.versionName || APP_CONFIG.version
    versionText.value = String(name).startsWith('v') ? String(name) : `v${name}`
  } catch {
    versionText.value = APP_CONFIG.version
  }
}

onShow(() => {
  void refreshVersion()
})

async function onCheckUpdate() {
  if (checking.value) return
  checking.value = true
  try {
    await checkAndPromptAppUpdate({ manual: true })
  } finally {
    checking.value = false
  }
}

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
      <view class="check-btn" @click="onCheckUpdate">
        <text class="check-btn-text">{{ checking ? '检查中...' : '检查更新' }}</text>
      </view>
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

.check-btn {
  margin-top: 48rpx;
  min-width: 240rpx;
  height: 80rpx;
  padding: 0 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a2fc2;
  border-radius: 12rpx;
}

.check-btn:active {
  opacity: 0.85;
}

.check-btn-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
  line-height: 44rpx;
}
</style>
