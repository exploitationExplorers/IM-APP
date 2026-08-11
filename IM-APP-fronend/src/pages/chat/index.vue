<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ConversationItem from '@/components/ConversationItem.vue'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { Conversation } from '@/types'

useAuthGuard()

const chatStore = useChatStore()
const userStore = useUserStore()
const keyword = ref('')
const showMoreMenu = ref(false)

const filtered = computed(() => {
  const list = chatStore.conversations
  if (!keyword.value.trim()) return list
  const k = keyword.value.trim()
  return list.filter((c) => c.title.includes(k) || c.lastMessage.includes(k))
})

async function ensureAuthAndLoad() {
  if (!userStore.isLoggedIn && !userStore.token) {
    // mock 下允许直接看页面；若无 token 也可先登录
  }
  await chatStore.loadConversations()
}

onMounted(ensureAuthAndLoad)
onShow(() => {
  chatStore.syncTabBadge()
})

function openConversation(item: Conversation) {
  showMoreMenu.value = false
  uni.navigateTo({
    url: `/pages/chat/room?id=${item.id}&title=${encodeURIComponent(item.title)}&avatar=${encodeURIComponent(item.avatar)}`,
  })
}

async function onMarkAllRead() {
  showMoreMenu.value = false
  await chatStore.markAllAsRead()
  uni.showToast({ title: '已全部标为已读', icon: 'none' })
}

function onAdd() {
  uni.showActionSheet({
    itemList: ['发起群聊', '添加朋友'],
    success: (res) => {
      if (res.tapIndex === 0) uni.navigateTo({ url: '/pages/contacts/groups' })
      if (res.tapIndex === 1) uni.navigateTo({ url: '/pages/contacts/new-friends' })
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="header">
      <text class="title">聊天</text>
      <view class="actions">
        <view class="icon-btn" @click.stop="showMoreMenu = !showMoreMenu">⋯</view>
        <view class="icon-btn" @click="onAdd">＋</view>
      </view>
      <view v-if="showMoreMenu" class="more-menu" @click.stop>
        <view class="more-item" @click="onMarkAllRead">全部已读</view>
      </view>
    </view>

    <AppSearchBar v-model="keyword" />

    <view class="filter-row">
      <text class="filter">全部 ▾</text>
    </view>

    <scroll-view scroll-y class="list" @click="showMoreMenu = false">
      <ConversationItem
        v-for="item in filtered"
        :key="item.id"
        :item="item"
        @click="openConversation"
      />
      <view v-if="!filtered.length" class="empty">暂无会话</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 88rpx 28rpx 16rpx;
}

.title {
  font-size: 44rpx;
  font-weight: 700;
  color: #111;
}

.actions {
  display: flex;
  gap: 8rpx;
}

.icon-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  color: #333;
}

.more-menu {
  position: absolute;
  top: 150rpx;
  right: 100rpx;
  background: #fff;
  border-radius: 12rpx;
  box-shadow: 0 8rpx 28rpx rgba(0, 0, 0, 0.12);
  z-index: 20;
  overflow: hidden;
}

.more-item {
  padding: 24rpx 40rpx;
  font-size: 28rpx;
  color: #333;
  white-space: nowrap;
}

.filter-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 28rpx 8rpx;
}

.filter {
  color: #666;
  font-size: 24rpx;
}

.list {
  flex: 1;
  height: 0;
}

.empty {
  text-align: center;
  color: #999;
  padding: 80rpx;
}
</style>
