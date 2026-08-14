<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchGroupDetail, fetchGroupQrcode } from '@/api/group'
import { APP_CONFIG } from '@/config'
import { buildQrcodeDataUrl } from '@/utils/qrcode'
import { buildQrcodeCardDataUrl, saveBase64ImageToAlbum } from '@/utils/qrcode-card'

const groupId = ref('')
const groupName = ref('')
const avatar = ref('')
const payload = ref('')
const qrUrl = ref('')
const loading = ref(true)

const nicknameInitial = computed(() => (groupName.value ? groupName.value.slice(0, 1) : '群'))

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    loading.value = false
    return
  }
  await loadQrcode()
})

async function loadQrcode() {
  loading.value = true
  try {
    const [detail, qrcode] = await Promise.all([
      fetchGroupDetail(groupId.value),
      fetchGroupQrcode(groupId.value),
    ])
    groupName.value = detail.name
    avatar.value = detail.avatar || APP_CONFIG.defaultGroupAvatarUrl
    payload.value = qrcode.payload
    qrUrl.value = await buildQrcodeDataUrl(qrcode.payload)
  } catch (e) {
    payload.value = ''
    qrUrl.value = ''
    uni.showToast({ title: (e as Error)?.message || '加载群二维码失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack()
}

async function onShare() {
  if (!payload.value) return
  // #ifdef H5
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: `${groupName.value}的群二维码`,
        text: '扫码进群',
      })
      return
    } catch {
      // 用户取消或不支持文件分享
    }
  }
  // #endif
  uni.setClipboardData({
    data: payload.value,
    success: () => uni.showToast({ title: '二维码内容已复制', icon: 'none' }),
  })
}

async function onSave() {
  if (!qrUrl.value) return
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    const cardUrl = await buildQrcodeCardDataUrl({
      nickname: groupName.value,
      nicknameInitial: nicknameInitial.value,
      avatarUrl: avatar.value || undefined,
      qrDataUrl: qrUrl.value,
      brandLogoUrl: '/static/auth/logo-full.png',
      caption: '扫码进群',
    })

    // #ifdef H5
    const link = document.createElement('a')
    link.href = cardUrl
    link.download = `${groupName.value || 'group-qrcode'}.png`
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
      <text class="nav-title">群二维码</text>
      <view class="nav-action" @click="onShare">
        <image class="nav-action-icon" src="/static/icons/icon-share.svg" mode="aspectFit" />
      </view>
    </view>

    <view class="body">
      <view class="user-row">
        <image class="avatar" :src="avatar || APP_CONFIG.defaultGroupAvatarUrl" mode="aspectFill" />
        <text class="nickname">{{ groupName }}</text>
        <image class="brand-logo" src="/static/auth/logo-full.png" mode="aspectFit" />
      </view>

      <view class="qr-wrap">
        <view v-if="loading" class="qr-loading">加载中...</view>
        <image
          v-else-if="qrUrl"
          class="qr-image"
          :src="qrUrl"
          mode="aspectFit"
          show-menu-by-longpress
        />
        <view v-else class="qr-loading">二维码加载失败</view>
      </view>

      <text class="caption">扫码进群</text>
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
  background: #fff;
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
  box-sizing: border-box;
}

.nav-back,
.nav-action {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-back {
  justify-content: flex-start;
}

.nav-back-icon,
.nav-action-icon {
  width: 44rpx;
  height: 44rpx;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #212121;
}

.body {
  flex: 1;
  padding: 32rpx 40rpx 24rpx;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  color: #9aa3b5;
  font-size: 28rpx;
}

.caption {
  display: block;
  margin-top: 24rpx;
  text-align: center;
  font-size: 28rpx;
  color: #9aa3b5;
}

.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  padding: 32rpx 80rpx;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
}

.bottom-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  min-width: 120rpx;
}

.bottom-icon {
  width: 48rpx;
  height: 48rpx;
}

.bottom-text {
  font-size: 26rpx;
  color: #636e86;
}
</style>
