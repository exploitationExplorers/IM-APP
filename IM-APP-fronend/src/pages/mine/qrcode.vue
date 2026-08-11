<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { fetchQrcode } from '@/api/user'
import type { QrcodePayload } from '@/types'

const userStore = useUserStore()
const qrcode = ref<QrcodePayload | null>(null)

onMounted(async () => {
  try {
    qrcode.value = await fetchQrcode()
  } catch {
    qrcode.value = {
      publicId: userStore.profile?.publicId || '',
      nickname: userStore.profile?.nickname || '',
      avatar: userStore.profile?.avatar || '',
      payload: '',
    }
  }
})
</script>

<template>
  <view class="page">
    <view class="card">
      <image
        class="avatar"
        :src="qrcode?.avatar || userStore.profile?.avatar || '/static/avatar-me.png'"
        mode="aspectFill"
      />
      <text class="name">{{ qrcode?.nickname || userStore.profile?.nickname }}</text>
      <text class="pid">公开 ID: {{ qrcode?.publicId }}</text>
      <view class="qr">
        <view class="qr-box">
          <text class="qr-id">{{ qrcode?.publicId }}</text>
          <text class="qr-hint">扫码加好友</text>
        </view>
      </view>
      <text class="tip">扫一扫上面的二维码，加我为好友</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding: 40rpx;
}

.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 48rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: #eee;
}

.name {
  margin-top: 20rpx;
  font-size: 32rpx;
  font-weight: 600;
}

.pid {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #999;
}

.qr {
  margin-top: 40rpx;
}

.qr-box {
  width: 360rpx;
  height: 360rpx;
  background: #f8f9fb;
  border: 2rpx solid #e1e3ea;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
}

.qr-id {
  font-size: 40rpx;
  font-weight: 700;
  color: #222;
  letter-spacing: 2rpx;
}

.qr-hint {
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #999;
}

.tip {
  margin-top: 28rpx;
  color: #999;
  font-size: 24rpx;
}
</style>
