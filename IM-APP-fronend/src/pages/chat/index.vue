<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ConversationItem from '@/components/ConversationItem.vue'
import { useChatStore } from '@/stores/chat'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { Conversation } from '@/types'

useAuthGuard()

const chatStore = useChatStore()
const keyword = ref('')
const showAddMenu = ref(false)
const showFilter = ref(false)
const filterKey = ref<'all' | 'unread'>('all')

const filterLabel = computed(() => (filterKey.value === 'unread' ? '未读' : '全部'))

const filtered = computed(() => {
  let list = chatStore.conversations
  if (filterKey.value === 'unread') {
    list = list.filter((c) => c.unreadCount > 0)
  }
  if (!keyword.value.trim()) return list
  const k = keyword.value.trim()
  return list.filter((c) => c.title.includes(k) || c.lastMessage.includes(k))
})

onMounted(() => {
  chatStore.loadConversations()
})

onShow(() => {
  chatStore.syncTabBadge()
})

function openConversation(item: Conversation) {
  showAddMenu.value = false
  showFilter.value = false
  uni.navigateTo({
    url: `/pages/chat/room?id=${item.id}&title=${encodeURIComponent(item.title)}&avatar=${encodeURIComponent(item.avatar)}`,
  })
}

function onAdd() {
  showFilter.value = false
  showAddMenu.value = !showAddMenu.value
}

function go(url: string) {
  showAddMenu.value = false
  uni.navigateTo({ url })
}

function setFilter(key: 'all' | 'unread') {
  filterKey.value = key
  showFilter.value = false
}

function closeMenus() {
  showAddMenu.value = false
  showFilter.value = false
}
</script>

<template>
  <view class="page" @click="closeMenus">
    <view class="header">
      <text class="title">聊天</text>
      <view class="add-wrap" @click.stop="onAdd">
        <text class="icon-btn">＋</text>
        <view v-if="showAddMenu" class="popup-menu">
          <view class="popup-item" @click="go('/pages/group/create')">发起群聊</view>
          <view class="popup-item" @click="go('/pages/contacts/add-friend')">添加朋友</view>
        </view>
      </view>
    </view>

    <AppSearchBar v-model="keyword" />

    <view class="filter-row">
      <view class="filter-wrap" @click.stop="showFilter = !showFilter">
        <text class="filter">{{ filterLabel }}</text>
        <text class="filter-caret">▾</text>
        <view v-if="showFilter" class="popup-menu filter-menu">
          <view
            class="popup-item"
            :class="{ active: filterKey === 'all' }"
            @click="setFilter('all')"
          >全部</view>
          <view
            class="popup-item"
            :class="{ active: filterKey === 'unread' }"
            @click="setFilter('unread')"
          >未读</view>
        </view>
      </view>
    </view>

    <scroll-view scroll-y class="list">
      <ConversationItem
        v-for="item in filtered"
        :key="item.id"
        :item="item"
        @click="openConversation"
      />
      <view v-if="!filtered.length" class="empty">无聊天消息</view>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 28rpx 16rpx;
}

.title {
  font-size: 44rpx;
  font-weight: 700;
  color: #212121;
}

.add-wrap {
  position: relative;
}

.icon-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44rpx;
  color: #212121;
  line-height: 1;
}

.popup-menu {
  position: absolute;
  top: 72rpx;
  right: 0;
  min-width: 220rpx;
  background: #fff;
  border-radius: 12rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
  z-index: 30;
  overflow: hidden;
}

.filter-menu {
  top: 48rpx;
}

.popup-item {
  padding: 28rpx 32rpx;
  font-size: 28rpx;
  color: #212121;
  white-space: nowrap;
}

.popup-item.active {
  color: #0a2fc2;
}

.filter-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 28rpx 8rpx;
}

.filter-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.filter,
.filter-caret {
  color: #636e86;
  font-size: 24rpx;
}

.list {
  flex: 1;
  height: 0;
}

.empty {
  text-align: center;
  color: #8a8f9c;
  padding: 160rpx 40rpx;
  font-size: 28rpx;
}
</style>
