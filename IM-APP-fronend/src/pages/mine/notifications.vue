<template>
  <view class="page">
    <view class="setting-item">
      <view class="setting-content">
        <text class="setting-title">消息免打扰</text>
      </view>
      <ImSwitch v-model="settings.noDisturb" />
    </view>

    <template v-if="!settings.noDisturb">
      <view class="section-title section-title-first">应用未打开时</view>

      <view class="setting-item">
        <view class="setting-content">
          <text class="setting-title">新消息通知</text>
        </view>
        <ImSwitch v-model="settings.message" />
      </view>

      <view class="setting-item">
        <view class="setting-content">
          <text class="setting-title">语音邀请</text>
        </view>
        <ImSwitch v-model="settings.voice" />
      </view>

      <view class="section-title section-title-second">应用打开时</view>

      <view class="setting-item">
        <view class="setting-content">
          <text class="setting-title">声音</text>
        </view>
        <ImSwitch v-model="settings.sound" />
      </view>

      <!-- #ifdef APP-ANDROID -->
      <view class="setting-item">
        <view class="setting-content">
          <text class="setting-title">震动</text>
        </view>
        <ImSwitch v-model="settings.vibration" />
      </view>
      <!-- #endif -->
    </template>

    <view class="refresh-icon">
      <text>↻</text>
    </view>
  </view>
</template>

<script setup>
import { reactive } from "vue";
import ImSwitch from "@/components/ImSwitch.vue";

const settings = reactive({
  noDisturb: false,
  message: true,
  voice: true,
  sound: true,
  vibration: false,
});

const goBack = () => {
  uni.navigateBack();
};
</script>

<style scoped>
.page {
  width: 100%;
  min-height: 100vh;
  box-sizing: border-box;
  background: #fff;
  color: #111;
  overflow-y: auto;
}
.navbar {
  position: sticky;
  top: 0;
  z-index: 30;
  width: 100%;
  height: 96rpx;
  box-sizing: border-box;
  padding: 0 40rpx;
  display: flex;
  align-items: center;
  gap: 32rpx;
  background: #fff;
}
.navbar-back {
  width: 72rpx;
  height: 72rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.back-button {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.back-icon {
  font-family: Arial, sans-serif;
  font-size: 64rpx;
  font-weight: 300;
  line-height: 64rpx;
  color: #333;
  transform: translateY(-4rpx);
}
.navbar-title-wrap {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
}
.navbar-title {
  font-size: 44rpx;
  font-weight: 700;
  line-height: 60rpx;
  color: #111;
  white-space: nowrap;
}
.navbar-placeholder {
  width: 72rpx;
  height: 72rpx;
  flex: none;
  visibility: hidden;
}
.setting-item {
  width: 100%;
  min-height: 96rpx;
  box-sizing: border-box;
  padding: 16rpx 40rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  border-radius: 8rpx;
}
.setting-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8rpx;
}
.setting-title {
  font-size: 30rpx;
  line-height: 44rpx;
  color: #111;
  white-space: nowrap;
}
.section-title {
  width: 100%;
  box-sizing: border-box;
  border-top: 1rpx solid #e5e7eb;
  margin-top: 30rpx;
  padding-top: 30rpx;
  padding-bottom: 16rpx;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 44rpx;
  color: #111;
}
.section-title-first {
  margin-left: 40rpx;
  margin-right: 40rpx;
  width: calc(100% - 80rpx);
}
.section-title-second {
  margin-left: 40rpx;
  margin-right: 40rpx;
  width: calc(100% - 80rpx);
}
.refresh-icon {
  position: fixed;
  top: 0;
  left: 50%;
  z-index: 999;
  width: 72rpx;
  height: 72rpx;
  box-sizing: border-box;
  transform: translateX(-50%);
  border-radius: 50%;
  background: #f5f5f5;
  padding: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #153dcc;
  opacity: 0;
}
.refresh-icon text {
  font-size: 48rpx;
  line-height: 48rpx;
}
.back-button:active {
  opacity: 0.6;
}
</style>
