<template>
  <view class="page">
    <view class="cell">
      <text>多语言</text>
      <text class="right">简体中文 ›</text>
    </view>
    <view class="cell">
      <text>清除缓存</text>
      <text class="right">›</text>
    </view>
    <view class="cell">
      <text>关于我们</text>
      <text class="right">›</text>
    </view>
    <view class="tip">设置项为占位，后续对接后端配置。</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding-top: 16rpx;
}
.cell {
  background: #fff;
  padding: 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 30rpx;
}
.right {
  color: #999;
}
.tip {
  color: #999;
  font-size: 24rpx;
  padding: 24rpx 28rpx;
}
</style>
