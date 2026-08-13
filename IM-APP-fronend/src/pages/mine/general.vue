<script setup lang="ts">
import { ref } from 'vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { clearAppCache } from '@/utils/app-cache'
import { reselectLine } from '@/utils/reselect-line'

useAuthGuard()

const showClearModal = ref(false)
const showLineModal = ref(false)
const clearing = ref(false)
const selectingLine = ref(false)

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/index' })
}

function goFeedback() {
  uni.navigateTo({ url: '/pages/mine/feedback' })
}

function goAbout() {
  uni.navigateTo({ url: '/pages/mine/about' })
}

function onLanguage() {
  uni.showToast({ title: '暂仅支持简体中文', icon: 'none' })
}

function onDisplayMode() {
  uni.showToast({ title: '暂仅支持行动版', icon: 'none' })
}

function onDebug() {
  uni.showToast({ title: '调试资讯仅内部可见', icon: 'none' })
}

function openClearModal() {
  showClearModal.value = true
}

function openLineModal() {
  showLineModal.value = true
}

function closeClearModal() {
  if (clearing.value) return
  showClearModal.value = false
}

function closeLineModal() {
  if (selectingLine.value) return
  showLineModal.value = false
}

function confirmClearCache() {
  if (clearing.value) return
  clearing.value = true
  try {
    clearAppCache()
    showClearModal.value = false
    uni.showToast({ title: '已清除缓存', icon: 'success' })
  } catch {
    uni.showToast({ title: '清除失败', icon: 'none' })
  } finally {
    clearing.value = false
  }
}

async function confirmReselectLine() {
  if (selectingLine.value) return
  selectingLine.value = true
  try {
    await reselectLine()
    showLineModal.value = false
    uni.showToast({ title: '选线完成', icon: 'success' })
  } catch {
    uni.showToast({ title: '选线失败', icon: 'none' })
  } finally {
    selectingLine.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-back-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">通用</text>
      <view class="nav-spacer" />
    </view>

    <view class="cell" @click="onLanguage">
      <text class="label">切换语言</text>
      <view class="right">
        <text class="value">简体中文</text>
        <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
      </view>
    </view>
    <view class="cell" @click="onDisplayMode">
      <text class="label">显示模式</text>
      <view class="right">
        <text class="value">行动版</text>
        <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
      </view>
    </view>
    <view class="cell" @click="goFeedback">
      <text class="label">意见反馈</text>
      <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
    </view>
    <view class="cell" @click="goAbout">
      <text class="label">关于我们</text>
      <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
    </view>
    <view class="cell" @click="openClearModal">
      <text class="label">清除缓存数据</text>
      <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
    </view>
    <view class="cell" @click="openLineModal">
      <text class="label">重新选线</text>
      <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
    </view>
    <view class="cell" @click="onDebug">
      <text class="label">调试资讯</text>
      <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
    </view>

    <view v-if="showClearModal" class="modal-mask" @click="closeClearModal">
      <view class="modal" @click.stop>
        <text class="modal-title">释放存储空间</text>
        <text class="modal-desc">释放存储空间将会清除部分本地暂存资料，不会造成使用上的影响</text>
        <view class="modal-actions">
          <text class="modal-cancel" @click="closeClearModal">取消</text>
          <view class="modal-confirm" @click="confirmClearCache">
            <text class="modal-confirm-text">确认</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="showLineModal" class="modal-mask" @click="closeLineModal">
      <view class="modal modal-line" @click.stop>
        <text class="modal-title">重新选线</text>
        <view class="modal-actions">
          <text class="modal-cancel" @click="closeLineModal">取消</text>
          <view class="modal-confirm" @click="confirmReselectLine">
            <text class="modal-confirm-text">确认</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
$primary: #0a2fc2;
$text: #212121;
$muted: #636e86;

.page {
  min-height: 100vh;
  background: #fff;
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

.cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  min-height: 96rpx;
  box-sizing: border-box;
  gap: 16rpx;
}

.cell:active {
  background: #f7f8fa;
}

.label {
  font-size: 30rpx;
  color: $text;
  line-height: 44rpx;
}

.right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.value {
  font-size: 28rpx;
  color: $muted;
  line-height: 40rpx;
}

.arrow {
  width: 32rpx;
  height: 32rpx;
  flex-shrink: 0;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}

.modal {
  width: 100%;
  max-width: 640rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 40rpx 36rpx 28rpx;
  box-sizing: border-box;
}

.modal-line {
  min-height: 240rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.modal-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: $text;
  line-height: 48rpx;
}

.modal-desc {
  display: block;
  margin-top: 24rpx;
  font-size: 28rpx;
  color: #5a6478;
  line-height: 44rpx;
}

.modal-actions {
  margin-top: 40rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 24rpx;
}

.modal-cancel {
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  color: $text;
  line-height: 40rpx;
}

.modal-confirm {
  min-width: 120rpx;
  height: 64rpx;
  padding: 0 28rpx;
  border-radius: 10rpx;
  background: $primary;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.modal-confirm-text {
  font-size: 28rpx;
  color: #fff;
  line-height: 40rpx;
  font-weight: 600;
}
</style>
