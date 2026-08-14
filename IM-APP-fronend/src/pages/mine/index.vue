<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useTabBar } from '@/composables/useTabBar'
import { APP_CONFIG } from '@/config'
import ImTabBar from '@/components/ImTabBar.vue'

useAuthGuard()
useTabBar()
const userStore = useUserStore()

const nickname = computed(() => userStore.profile?.nickname || '未登录')
const avatarSrc = computed(
  () => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl,
)

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
    <view class="mine-header">
      <view class="mine-hero-card">
        <view class="mine-profile">
          <view class="mine-avatar-ring">
            <image class="mine-avatar" :src="avatarSrc" mode="aspectFill" />
          </view>
          <text class="mine-nickname">{{ nickname }}</text>
        </view>

        <view class="mine-actions">
          <view class="mine-action-btn" @click="go('/pages/mine/profile')">
            <image class="mine-action-icon" src="/static/mine/icon-edit.svg" mode="aspectFit" />
          </view>
          <view class="mine-action-btn" @click="go('/pages/mine/qrcode')">
            <image class="mine-action-icon" src="/static/mine/icon-qrcode.svg" mode="aspectFit" />
          </view>
        </view>
      </view>

      <view class="mine-nav">
        <text class="mine-nav-title">个人中心</text>
        <view class="mine-nav-spacer" />
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
$page-bg: #f5f6f8;
$primary: #0a2fc2;

.page {
  min-height: 100vh;
  background: $page-bg;
  padding-bottom: calc(144rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.mine-header {
  position: sticky;
  top: 0;
  z-index: 40;
}

/* flex items-center justify-between pt-18 pb-6 px-6 */
.mine-hero-card {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(144rpx + env(safe-area-inset-top)) 48rpx 48rpx;
  background-color: $primary;
  background-image: url('/static/mine/my-title.webp');
  background-size: cover;
  background-repeat: no-repeat;
  background-position: center;
  background-blend-mode: luminosity;
  box-sizing: border-box;
}

/* 左侧：头像 + 昵称，不撑满整行 */
.mine-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
}

.mine-avatar-ring {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  overflow: hidden;
  border: 4rpx solid #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12);
  background: #f3f4f7;
  box-sizing: border-box;
}

.mine-avatar {
  width: 100%;
  height: 100%;
  display: block;
}

.mine-nickname {
  width: 160rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 48rpx;
  color: #fff;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右侧：编辑 / 二维码 */
.mine-actions {
  display: flex;
  align-items: center;
  gap: 4rpx;
  flex-shrink: 0;
  align-self: center;
}

.mine-action-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mine-action-icon {
  width: 40rpx;
  height: 40rpx;
}

.mine-nav {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  height: calc(96rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 40rpx 0;
  box-sizing: border-box;
  background: transparent;
  pointer-events: none;
}

.mine-nav-title {
  flex: 1;
  min-width: 0;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 64rpx;
  color: #fff;
  text-align: left;
}

.mine-nav-spacer {
  width: 96rpx;
  height: 96rpx;
  flex-shrink: 0;
  visibility: hidden;
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
