<script setup lang="ts">
import { nextTick } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { decodeQrcodeFromImage, routeQrcodeScanResult, tryDecodeQrcode } from '@/utils/qrcode'

let navigating = false
let h5Video: HTMLVideoElement | null = null
let h5Stream: MediaStream | null = null
let h5Timer: ReturnType<typeof setTimeout> | null = null
let h5Canvas: HTMLCanvasElement | null = null

function goBack() {
  stopH5Scan()
  uni.navigateBack()
}

function goMyQrcode() {
  stopH5Scan()
  uni.navigateTo({ url: '/pages/mine/qrcode' })
}

function handleScanRaw(raw: string) {
  if (navigating) return
  if (!routeQrcodeScanResult(raw)) {
    uni.showToast({ title: '未识别到有效二维码', icon: 'none' })
    return
  }
  navigating = true
  stopH5Scan()
}

function stopH5Scan() {
  if (h5Timer) {
    clearTimeout(h5Timer)
    h5Timer = null
  }
  if (h5Stream) {
    h5Stream.getTracks().forEach((track) => track.stop())
    h5Stream = null
  }
  h5Video = null
  const wrap = typeof document !== 'undefined' ? document.getElementById('h5-scan-camera') : null
  if (wrap) wrap.innerHTML = ''
}

function tickH5Scan() {
  if (navigating || !h5Video) return
  const width = h5Video.videoWidth
  const height = h5Video.videoHeight
  if (width && height) {
    if (!h5Canvas) h5Canvas = document.createElement('canvas')
    h5Canvas.width = width
    h5Canvas.height = height
    const ctx = h5Canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(h5Video, 0, 0, width, height)
      const imageData = ctx.getImageData(0, 0, width, height)
      const raw = tryDecodeQrcode(imageData.data, width, height)
      if (raw) {
        handleScanRaw(raw)
        return
      }
    }
  }
  h5Timer = setTimeout(tickH5Scan, 220)
}

async function startH5Scan() {
  if (typeof document === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    uni.showToast({ title: '当前环境不支持摄像头扫码', icon: 'none' })
    return
  }
  stopH5Scan()
  const wrap = document.getElementById('h5-scan-camera')
  if (!wrap) return
  const video = document.createElement('video')
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.muted = true
  video.autoplay = true
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000;display:block;'
  wrap.appendChild(video)
  h5Video = video
  try {
    h5Stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    })
    video.srcObject = h5Stream
    await video.play()
    tickH5Scan()
  } catch {
    stopH5Scan()
    uni.showToast({ title: '无法打开相机，请允许摄像头权限', icon: 'none' })
  }
}

function chooseFromAlbum() {
  uni.chooseImage({
    count: 1,
    sourceType: ['album'],
    success: async (res) => {
      const path = res.tempFilePaths[0]
      if (!path) return
      uni.showLoading({ title: '识别中...', mask: true })
      try {
        const raw = await decodeQrcodeFromImage(path)
        handleScanRaw(raw)
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '未识别到有效二维码', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },
  })
}

onShow(() => {
  navigating = false
  // #ifdef H5
  void nextTick(() => startH5Scan())
  // #endif
})

onHide(() => {
  stopH5Scan()
})

onUnload(() => {
  stopH5Scan()
})
</script>

<template>
  <view class="page">
    <view id="h5-scan-camera" class="camera-feed" />
    <view class="back-btn" @click="goBack">
      <image class="back-icon" src="/static/icons/icon-back-white.svg" mode="aspectFit" />
    </view>
    <view class="scan-area">
      <view class="scan-frame" />
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
  height: 100vh;
  background: #000;
  display: flex;
  flex-direction: column;
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
}

.camera-feed {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  background: #000;
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
  box-shadow: 0 0 1px 100vw rgba(0, 0, 0, 0.45);
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
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
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
