<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const groupId = ref('')
const code = ref('group')
const groupName = ref('观赏世界的窗')
const avatar = ref('/static/avatar-1.png')

const memberList = [
  { id: '1', name: 'bug001', avatar: '/static/avatar-1.png' },
  { id: '2', name: '妲己把茶…', avatar: '/static/avatar-1.png' },
  { id: '3', name: '勿忘国耻', avatar: '/static/avatar-1.png' },
  { id: '4', name: '月薪3.8k', avatar: '/static/avatar-1.png' },
]

onLoad((query) => {
  groupId.value = String(query?.id || '')
  code.value = String(query?.code || 'group')
})

onMounted(() => {
  console.log('detail page mounted', groupId.value, code.value)
})

function goBack() {
  uni.navigateBack()
}

function copyGroupId() {
  uni.setClipboardData({
    data: '338495',
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}
</script>

<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">群详细</text>
      <view class="header-spacer" />
    </view>

    <view class="members-wrap">
      <view class="member-row">
        <view v-for="member in memberList" :key="member.id" class="member-item">
          <image class="member-avatar" :src="member.avatar" mode="aspectFill" />
          <text class="member-name">{{ member.name }}</text>
        </view>
        <view class="add-member">
          <view class="add-circle">＋</view>
        </view>
      </view>
    </view>

    <view class="group-row section-row">
      <text class="label">群组成员</text>
      <view class="row-right">
        <text class="muted">共5人</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="info-list">
      <view class="info-row">
        <text class="label">群组名称</text>
        <text class="value">{{ groupName }}</text>
      </view>

      <view class="info-row">
        <text class="label">群头像</text>
        <view class="avatar-box">
          <image class="current-avatar" :src="avatar" mode="aspectFill" />
        </view>
      </view>

      <view class="info-row">
        <text class="label">群ID</text>
        <view class="row-right id-box">
          <text class="value id-value">338495</text>
          <view class="copy-btn" @click="copyGroupId">复制</view>
        </view>
      </view>

      <view class="info-row nav-row">
        <text class="label">群公告</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row">
        <text class="label">群二维码</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row">
        <text class="label">我在本群的昵称</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row">
        <text class="label">图片与视频</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row">
        <text class="label">搜索聊天记录</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row last-nav">
        <text class="label">清除聊天记录</text>
        <text class="arrow">›</text>
      </view>

      <view class="switch-row">
        <text class="label">消息免打扰</text>
        <view class="switch-track">
          <view class="switch-knob" />
        </view>
      </view>

      <view class="switch-row">
        <text class="label">置顶聊天</text>
        <view class="switch-track">
          <view class="switch-knob" />
        </view>
      </view>

      <view class="action-row">
        <text class="label">检举</text>
        <text class="arrow">›</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f5f5;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 26rpx;
  background: #ffffff;
}

.back-btn {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.header-spacer {
  width: 52rpx;
  height: 52rpx;
}

.members-wrap {
  background: #fff;
  padding: 20rpx 22rpx 18rpx;
}

.member-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
}

.member-item {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.member-avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #eaeaea;
}

.member-name {
  font-size: 22rpx;
  color: #555;
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-member {
  width: 112rpx;
  display: flex;
  justify-content: center;
  align-items: center;
}

.add-circle {
  width: 90rpx;
  height: 90rpx;
  border-radius: 50%;
  border: 2rpx dashed #b8b8b8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 50rpx;
  color: #8a8a8a;
}

.section-row {
  margin-top: 18rpx;
  border-top: 1rpx solid #f0f0f0;
  border-bottom: 1rpx solid #f0f0f0;
}

.group-row {
  background: #fff;
  padding: 28rpx 30rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.label {
  font-size: 30rpx;
  color: #1d1d1d;
}

.row-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.muted {
  font-size: 28rpx;
  color: #666;
}

.arrow {
  font-size: 40rpx;
  color: #999;
}

.info-list {
  margin-top: 8rpx;
  background: #fff;
}

.info-row {
  min-height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.value {
  font-size: 30rpx;
  color: #666;
  max-width: 50%;
}

.avatar-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #e9f2ff;
}

.current-avatar {
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: #d8eaff;
}

.id-box {
  gap: 18rpx;
}

.id-value {
  color: #444;
}

.copy-btn {
  min-width: 100rpx;
  height: 52rpx;
  padding: 0 22rpx;
  border-radius: 12rpx;
  background: #1e88ff;
  color: #fff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-row {
  cursor: pointer;
}

.last-nav {
  border-bottom: 1rpx solid #f0f0f0;
}

.switch-row {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  background: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.switch-track {
  width: 76rpx;
  height: 40rpx;
  border-radius: 24rpx;
  background: #d9d9d9;
  position: relative;
  display: flex;
  align-items: center;
  padding: 4rpx;
}

.switch-knob {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.16);
  position: absolute;
  left: 6rpx;
}

.action-row {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  background: #fff;
}
</style>
