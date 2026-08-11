<template>
  <view class="page">
    <view class="cell">
      <text>加我为好友时需要验证</text>
      <switch checked color="#2B5CFF" />
    </view>
    <view class="cell">
      <text>通过手机号找到我</text>
      <switch checked color="#2B5CFF" />
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
.tip {
  color: #999;
  font-size: 24rpx;
  padding: 24rpx 28rpx;
}
</style>
