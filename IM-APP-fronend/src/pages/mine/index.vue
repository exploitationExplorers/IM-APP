<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'

useAuthGuard()
const userStore = useUserStore()

const nickname = computed(() => userStore.profile?.nickname || '未登录')
const avatar = computed(() => userStore.profile?.avatar || '/static/avatar-me.png')

const menus = [
  { title: '我的收藏', icon: '★', color: '#f5a623', url: '/pages/mine/favorites' },
  { title: '通知设置', icon: '🔔', color: '#3b7bff', url: '/pages/mine/notifications' },
  { title: '聊天设置', icon: '💬', color: '#3b7bff', url: '/pages/mine/chat-settings' },
  { title: '隐私', icon: '🔒', color: '#3b7bff', url: '/pages/mine/privacy' },
  { title: '安全', icon: '🛡', color: '#3b7bff', url: '/pages/mine/security' },
  { title: '通用', icon: '⚙', color: '#666', url: '/pages/mine/general' },
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
        <view class="meta">
          <text class="nickname">{{ nickname }}</text>
        </view>
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
        <view class="menu-icon" :style="{ color: m.color }">{{ m.icon }}</view>
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
  background: linear-gradient(180deg, #3b7bff 0%, #6aa0ff 100%);
  padding: 88rpx 32rpx 48rpx;
  color: #fff;
}

.hero-title {
  font-size: 34rpx;
  font-weight: 600;
}

.profile {
  margin-top: 36rpx;
  display: flex;
  align-items: center;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.3);
}

.meta {
  flex: 1;
  margin-left: 24rpx;
}

.nickname {
  font-size: 34rpx;
  font-weight: 600;
}

.hero-actions {
  display: flex;
  gap: 16rpx;
}

.hero-btn {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
}

.menu-card {
  margin-top: 16rpx;
  background: #fff;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 30rpx 28rpx;
  border-bottom: 1rpx solid #f3f3f3;
}

.menu-icon {
  width: 48rpx;
  margin-right: 16rpx;
  font-size: 32rpx;
}

.menu-text {
  flex: 1;
  font-size: 30rpx;
  color: #222;
}

.arrow {
  color: #ccc;
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
  margin-right: 16rpx;
}
</style>
