<script setup lang="ts">
import { ref, computed } from 'vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImSwipeActionItem from '@/components/ImSwipeActionItem.vue'
import ImTabBar from '@/components/ImTabBar.vue'
import ImNotificationPermissionDialog from '@/components/ImNotificationPermissionDialog.vue'
import { useChatStore } from '@/stores/chat'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { usePullRefresh } from '@/composables/usePullRefresh'
import { useTabBar } from '@/composables/useTabBar'
import type { Conversation } from '@/types'
import { getStatusBarHeight } from '@/utils/status-bar'
import { openQrScanner } from '@/utils/qrcode'

useAuthGuard()
useTabBar()

const statusBarHeight = getStatusBarHeight()
const chatStore = useChatStore()
const keyword = ref('')
const showAddMenu = ref(false)
const showFilter = ref(false)
const filterKey = ref<'all' | 'unread'>('all')

const filterLabel = computed(() => (filterKey.value === 'unread' ? '未读' : '全部'))

// 当前左滑展开的会话 id（同一时间只允许一个 row 展开）
const activeSwipeId = ref<string | null>(null)

// uni-swipe-action-item 通过 change 事件回报展开/收起状态，同步到 activeSwipeId
function onSwipeChange(item: Conversation, open: string) {
  activeSwipeId.value = open === 'right' ? item.id : null
}

// 点击「置顶」按钮
async function onTogglePin(item: Conversation) {
  activeSwipeId.value = null
  try {
    await chatStore.togglePin(item.id)
  } catch (e) {
    uni.showToast({
      title: (e as Error)?.message || '置顶失败',
      icon: 'none',
    })
  }
}

// 点击「移除」按钮
async function onHideConversation(item: Conversation) {
  activeSwipeId.value = null
  try {
    await chatStore.hideConversationLocal(item.id)
  } catch (e) {
    uni.showToast({
      title: (e as Error)?.message || '移除失败',
      icon: 'none',
    })
  }
}

// 点击 row 内容区 → 打开会话
function onSwipeItemClick(item: Conversation) {
  activeSwipeId.value = null
  openConversation(item)
}

const filtered = computed(() => {
  let list = chatStore.conversations
  if (filterKey.value === 'unread') {
    list = list.filter((c) => c.unreadCount > 0)
  }
  if (!keyword.value.trim()) return list
  const k = keyword.value.trim()
  return list.filter((c) => c.title.includes(k) || c.lastMessage.includes(k))
})

async function reloadConversations() {
  try {
    await chatStore.loadConversations()
  } catch (e) {
    const message = (e as Error)?.message || '会话加载失败'
    if (message.includes('自定义调试基座')) {
      uni.showModal({ title: '无法连接聊天', content: message, showCancel: false })
      return
    }
    uni.showToast({ title: message, icon: 'none' })
  }
}

const { refreshing, onRefresherRefresh } = usePullRefresh(reloadConversations)

function openConversation(item: Conversation) {
  showAddMenu.value = false
  showFilter.value = false
  uni.navigateTo({
    url: `/pages/chat/room?conversationId=${encodeURIComponent(item.id)}&type=${item.type}&title=${encodeURIComponent(item.title)}&avatar=${encodeURIComponent(item.avatar)}`,
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

function goScan() {
  showAddMenu.value = false
  openQrScanner()
}

function setFilter(key: 'all' | 'unread') {
  filterKey.value = key
  showFilter.value = false
}

function closeMenus() {
  showAddMenu.value = false
  showFilter.value = false
  activeSwipeId.value = null
}
</script>

<template>
  <view class="page" @click="closeMenus">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <text class="title">聊天</text>
      <view class="add-wrap" @click.stop="onAdd">
        <image class="icon-plus" src="/static/icons/icon-plus.svg" mode="aspectFit" />
        <view v-if="showAddMenu" class="popup-menu">
          <view class="popup-item" @click="go('/pages/contacts/add-friend')">
            <image class="popup-icon" src="/static/icons/menu-add-friend.svg" mode="aspectFit" />
            <text>添加朋友</text>
          </view>
          <view class="popup-item" @click="goScan">
            <image class="popup-icon" src="/static/icons/menu-add-group.svg" mode="aspectFit" />
            <text>添加群聊</text>
          </view>
          <view class="popup-item" @click="go('/pages/group/create')">
            <image class="popup-icon" src="/static/icons/menu-create-group.svg" mode="aspectFit" />
            <text>创建群聊</text>
          </view>
        </view>
      </view>
    </view>

    <AppSearchBar v-model="keyword" />

    <view class="filter-row">
      <view class="filter-wrap" @click.stop="showFilter = !showFilter">
        <text class="filter">{{ filterLabel }}</text>
        <view class="filter-caret" />
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

    <scroll-view
      scroll-y
      class="list"
      refresher-enabled
      refresher-default-style="black"
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresherRefresh"
    >
      <uni-swipe-action>
        <ImSwipeActionItem
          v-for="item in filtered"
          :key="item.id"
          :item="item"
          :show="activeSwipeId === item.id ? 'right' : 'none'"
          @item-click="onSwipeItemClick"
          @change="(open) => onSwipeChange(item, open)"
        >
          <template #right>
            <view class="swipe-actions">
              <view
                class="swipe-btn swipe-btn-pin"
                :class="{ active: item.pinned }"
                @click.stop="onTogglePin(item)"
              >
                <text>{{ item.pinned ? '取消置顶' : '置顶' }}</text>
              </view>
              <view class="swipe-btn swipe-btn-remove" @click.stop="onHideConversation(item)">
                <text>移除</text>
              </view>
            </view>
          </template>
        </ImSwipeActionItem>
      </uni-swipe-action>
      <view v-if="!filtered.length" class="empty">无聊天消息</view>
    </scroll-view>

    <ImTabBar current="chat" />
    <ImNotificationPermissionDialog />
  </view>
</template>

<style scoped lang="scss">
.page {
  /* iOS Safari：只有 min-height 时，flex 子项 height:0 会塌成 0，会话列表整页空白 */
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(144rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

/* 与 contacts/mine 的 tab 大标题行统一：固定 96rpx 行高 + 垂直居中 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 40rpx;
  box-sizing: border-box;
}

.title {
  font-size: 48rpx;
  font-weight: 700;
  color: #212121;
  line-height: 64rpx;
}

.add-wrap {
  position: relative;
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-plus {
  width: 48rpx;
  height: 48rpx;
}

.popup-menu {
  position: absolute;
  top: 72rpx;
  right: 0;
  min-width: 288rpx;
  padding: 16rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 20rpx 30rpx -6rpx rgba(0, 0, 0, 0.1), 0 8rpx 12rpx -8rpx rgba(0, 0, 0, 0.1);
  z-index: 30;
}

.filter-menu {
  top: 48rpx;
  min-width: 200rpx;
  right: 0;
}

.popup-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 32rpx;
  font-size: 28rpx;
  color: #212121;
  white-space: nowrap;
  border-radius: 8rpx;
}

.popup-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.popup-item.active {
  color: #0a2fc2;
}

.filter-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 40rpx 8rpx;
}

.filter-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.filter {
  color: #636e86;
  font-size: 24rpx;
  line-height: 40rpx;
}

.filter-caret {
  width: 0;
  height: 0;
  border-left: 8rpx solid transparent;
  border-right: 8rpx solid transparent;
  border-top: 10rpx solid #636e86;
  margin-left: 4rpx;
}

.list {
  flex: 1;
  min-height: 0;
  /* #ifdef H5 */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* #endif */
}

.empty {
  text-align: center;
  color: #212121;
  padding: 80rpx 40rpx;
  font-size: 32rpx;
}

.swipe-actions {
  display: flex;
  flex-direction: row;
}

.swipe-btn {
  width: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #212121;
}

.swipe-btn-pin {
  background: #f0f1f4;
}

.swipe-btn-remove {
  background: #ffe5e5;
  color: #e54d42;
}

.swipe-btn.active {
  background: #e7e8ec;
}
</style>
