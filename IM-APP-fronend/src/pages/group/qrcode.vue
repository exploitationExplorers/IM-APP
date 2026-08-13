<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useGroupStore } from '@/stores/group'
import { buildQrcodeDataUrl } from '@/utils/qrcode'

const groupStore = useGroupStore()
const groupId = ref('')
const groupName = ref('')
const avatar = ref('')
const qrUrl = ref('')

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }

  try {
    const detail = await groupStore.loadDetail(groupId.value)
    groupName.value = detail.name
    avatar.value = detail.avatar || '/static/avatar-1.png'
    qrUrl.value = await buildQrcodeDataUrl(`group:${detail.id}`)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群二维码失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">群二维码</text>
      <view class="nav-spacer" />
    </view>

    <view class="card">
      <view class="user-row">
        <image class="avatar" :src="avatar || '/static/avatar-1.png'" mode="aspectFill" />
        <text class="nickname">{{ groupName }}</text>
        <image class="brand-logo" src="/static/auth/logo-full.png" mode="aspectFit" />
      </view>

      <view class="qr-wrap">
        <image v-if="qrUrl" class="qr-image" :src="qrUrl" mode="aspectFit" show-menu-by-longpress />
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

.nav-spacer {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
}

.card {
  flex: 1;
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
</style>
