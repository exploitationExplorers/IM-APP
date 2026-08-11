<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'

useAuthGuard()
const userStore = useUserStore()

const nickname = computed(() => userStore.profile?.nickname || '未登录')
const avatar = computed(() => userStore.profile?.avatar || '/static/avatar-me.png')

const menus = [
  { title: '我的收藏', icon: '☆', url: '/pages/mine/favorites' },
  { title: '通知设置', icon: '🔔', url: '/pages/mine/notifications' },
  { title: '聊天设置', icon: '💬', url: '/pages/mine/chat-settings' },
  { title: '隐私', icon: '🔒', url: '/pages/mine/privacy' },
  { title: '安全', icon: '🛡', url: '/pages/mine/security' },
  { title: '通用', icon: '⚙', url: '/pages/mine/general' },
]

onMounted(() => {
  if (userStore.isLoggedIn) {
    userStore.loadProfile().catch(() => undefined)
  }
})

function go(url: string) {
  uni.navigateTo({ url })
}

function onLogout() {
  uni.showModal({
    title: '提示',
    content: '确定退出登录吗？',
    success: (res) => {
      if (res.confirm) userStore.logout()
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <text class="hero-title">个人中心</text>
      <view class="profile">
        <image class="avatar" :src="avatar" mode="aspectFill" />
        <text class="nickname">{{ nickname }}</text>
        <view class="hero-actions">
          <view class="hero-btn" @click="go('/pages/mine/profile')">✎</view>
          <view class="hero-btn" @click="go('/pages/mine/qrcode')">▦</view>
        </view>
      </view>
    </view>

    <view class="menu-card">
      <view
        v-for="m in menus"
        :key="m.title"
        class="menu-item"
        @click="go(m.url)"
      >
        <text class="menu-icon">{{ m.icon }}</text>
        <text class="menu-text">{{ m.title }}</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="logout" @click="onLogout">
      <text class="logout-icon">⎋</text>
      <text class="logout-text">退出</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
}

.hero {
  background: #4a5568;
  padding: 32rpx 32rpx 48rpx;
  color: #fff;
}

.hero-title {
  font-size: 36rpx;
  font-weight: 600;
}

.profile {
  margin-top: 40rpx;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.2);
}

.nickname {
  margin-top: 20rpx;
  font-size: 34rpx;
  font-weight: 600;
}

.hero-actions {
  position: absolute;
  right: 0;
  top: 16rpx;
  display: flex;
  gap: 20rpx;
}

.hero-btn {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #fff;
}

.menu-card {
  background: #fff;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 30rpx 28rpx;
}

.menu-icon {
  width: 48rpx;
  margin-right: 20rpx;
  font-size: 32rpx;
  color: #636e86;
  text-align: center;
}

.menu-text {
  flex: 1;
  font-size: 30rpx;
  color: #212121;
}

.arrow {
  color: #c8ccd6;
  font-size: 36rpx;
}

.logout {
  margin-top: 16rpx;
  background: #fff;
  padding: 30rpx 28rpx;
  display: flex;
  align-items: center;
}

.logout-icon,
.logout-text {
  color: #e54d42;
  font-size: 30rpx;
}

.logout-icon {
  width: 48rpx;
  margin-right: 20rpx;
  text-align: center;
}
</style>
