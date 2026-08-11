<script setup lang="ts">
function goPlaceholder(title: string) {
  uni.showToast({ title: `${title}开发中`, icon: 'none' })
}

function onClearCache() {
  uni.showModal({
    title: '清除缓存数据',
    content: '确定清除本地缓存吗？',
    success: (res) => {
      if (res.confirm) uni.showToast({ title: '已清除', icon: 'none' })
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="cell" @click="goPlaceholder('切换语言')">
      <text class="label">切换语言</text>
      <view class="right">
        <text class="value">简体中文</text>
        <text class="arrow">›</text>
      </view>
    </view>
    <view class="cell" @click="goPlaceholder('显示模式')">
      <text class="label">显示模式</text>
      <view class="right">
        <text class="value">行动版</text>
        <text class="arrow">›</text>
      </view>
    </view>
    <view class="cell" @click="goPlaceholder('意见反馈')">
      <text class="label">意见反馈</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="goPlaceholder('关于我们')">
      <text class="label">关于我们</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="onClearCache">
      <text class="label">清除缓存数据</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="goPlaceholder('重新选线')">
      <text class="label">重新选线</text>
      <text class="arrow">›</text>
    </view>
    <view class="cell" @click="goPlaceholder('调试资讯')">
      <text class="label">调试资讯</text>
      <text class="arrow">›</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  min-height: 96rpx;
  box-sizing: border-box;
}

.label {
  font-size: 30rpx;
  color: #212121;
}

.right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.value {
  font-size: 28rpx;
  color: #636e86;
}

.arrow {
  color: #c8ccd6;
  font-size: 32rpx;
}
</style>
