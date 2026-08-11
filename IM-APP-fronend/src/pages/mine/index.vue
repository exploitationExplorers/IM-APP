<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useTabBar } from '@/composables/useTabBar'
import ImTabBar from '@/components/ImTabBar.vue'

useAuthGuard()
useTabBar()
const userStore = useUserStore()

const nickname = computed(() => userStore.profile?.nickname || '未登录')
const avatar = computed(() => userStore.profile?.avatar || '/static/avatar-me.png')

const menus = [
  { title: '我的收藏', icon: '/static/mine/icon-favorites.svg', url: '/pages/mine/favorites' },
  { title: '通知设置', icon: '/static/mine/icon-notifications.svg', url: '/pages/mine/notifications' },
  { title: '聊天设置', icon: '/static/mine/icon-chat-settings.svg', url: '/pages/mine/chat-settings' },
  { title: '隐私', icon: '/static/mine/icon-privacy.svg', url: '/pages/mine/privacy' },
  { title: '安全', icon: '/static/mine/icon-security.svg', url: '/pages/mine/security' },
  { title: '通用', icon: '/static/mine/icon-general.svg', url: '/pages/mine/general' },
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
          <image
            class="hero-btn"
            src="/static/mine/icon-edit.svg"
            mode="aspectFit"
            @click="go('/pages/mine/profile')"
          />
          <image
            class="hero-btn"
            src="/static/mine/icon-qrcode.svg"
            mode="aspectFit"
            @click="go('/pages/mine/qrcode')"
          />
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
        <image class="menu-icon" :src="m.icon" mode="aspectFit" />
        <text class="menu-text">{{ m.title }}</text>
        <image class="arrow" src="/static/mine/icon-chevron.svg" mode="aspectFit" />
      </view>
    </view>

    <view class="logout" @click="onLogout">
      <image class="logout-icon" src="/static/mine/icon-logout.svg" mode="aspectFit" />
      <text class="logout-text">退出</text>
    </view>

    <ImTabBar current="mine" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding-bottom: calc(144rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.hero {
  position: relative;
  background-color: #0a2fc2;
  background-image: url('/static/mine/hero-bg.webp');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  padding: 32rpx 48rpx 48rpx;
  color: #fff;
}

.hero-title {
  font-size: 48rpx;
  font-weight: 700;
  line-height: 64rpx;
  color: #fff;
}

.profile {
  margin-top: 48rpx;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.avatar {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  border: 4rpx solid #ffffff;
  background: #f3f4f7;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12);
}

.nickname {
  margin-top: 16rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #fff;
  max-width: 420rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-actions {
  position: absolute;
  right: 0;
  top: 24rpx;
  display: flex;
  align-items: center;
  gap: 32rpx;
}

.hero-btn {
  width: 40rpx;
  height: 40rpx;
}

.menu-card {
  background: #fff;
}

.menu-item {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 32rpx;
  gap: 16rpx;
}

.menu-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.menu-text {
  flex: 1;
  font-size: 32rpx;
  color: #212121;
  line-height: 48rpx;
}

.arrow {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.logout {
  margin-top: 16rpx;
  background: #fff;
  height: 96rpx;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.logout-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.logout-text {
  color: #dc2828;
  font-size: 32rpx;
  line-height: 48rpx;
}
</style>
