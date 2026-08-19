<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImTabBar from '@/components/ImTabBar.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { usePullRefresh } from '@/composables/usePullRefresh'
import { useTabBar } from '@/composables/useTabBar'
import type { Contact, ContactListSort, GroupPreview } from '@/types'
import { getStatusBarHeight } from '@/utils/status-bar'
import { openQrScanner } from '@/utils/qrcode'

useAuthGuard()
useTabBar()

const statusBarHeight = getStatusBarHeight()
const contactStore = useContactStore()
const { contacts, contactTotal, contactHasMore, contactsLoading, groups } = storeToRefs(contactStore)
const keyword = ref('')
const sortKey = ref<'recent' | 'name' | 'chat'>('recent')
const showSort = ref(false)
const showAddMenu = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const sortLabel = computed(() => {
  if (sortKey.value === 'name') return '名字'
  if (sortKey.value === 'chat') return '最近聊天'
  return '最近加入(默认)'
})

const listSort = computed<ContactListSort>(() => (sortKey.value === 'name' ? 'name' : 'recent'))

function listName(c: Contact) {
  return c.remark?.trim() || c.nickname
}

function refreshContacts() {
  return contactStore.reloadContacts({
    keyword: keyword.value,
    sort: listSort.value,
  })
}

function refreshDirectory() {
  return Promise.all([refreshContacts(), contactStore.loadGroups()])
}

/** 切回通讯录页面时刷新群列表（已解散群由服务端过滤后自动消失） */
onShow(() => {
  void refreshDirectory()
})

const { refreshing, onRefresherRefresh } = usePullRefresh(refreshDirectory)

watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void refreshContacts()
  }, 300)
})

function onLoadMore() {
  void contactStore.loadMoreContacts()
}

function onScroll(e: { detail?: { scrollTop?: number; scrollHeight?: number } }) {
  const top = e.detail?.scrollTop || 0
  const height = e.detail?.scrollHeight || 0
  const view = uni.getSystemInfoSync().windowHeight || 0
  if (height > 0 && height - top - view < 240) onLoadMore()
}

function go(url: string) {
  showAddMenu.value = false
  showSort.value = false
  uni.navigateTo({ url })
}

function goScan() {
  showAddMenu.value = false
  showSort.value = false
  openQrScanner()
}

function openContact(c: Contact) {
  go(`/pages/contacts/friend-detail?id=${c.id}`)
}

function openGroupChat(g: GroupPreview) {
  if (g.status === 'dismissed') {
    uni.navigateTo({ url: `/pages/group/detail?id=${encodeURIComponent(g.id)}&dissolved=1` })
    return
  }
  contactStore.openChatWithGroup(g.id, g.name, g.avatar || '/static/icons/menu-group.svg')
}

function onAdd() {
  showSort.value = false
  showAddMenu.value = !showAddMenu.value
}

function setSort(key: 'recent' | 'name' | 'chat') {
  sortKey.value = key
  showSort.value = false
  void refreshContacts()
}

function closeMenus() {
  showAddMenu.value = false
  showSort.value = false
}
</script>

<template>
  <view class="page" @click="closeMenus">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="header-row">
      <text class="title">通讯录</text>
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
    </view>

    <AppSearchBar v-model="keyword" />

    <scroll-view
      scroll-y
      class="body"
      refresher-enabled
      refresher-default-style="black"
      :refresher-triggered="refreshing"
      :lower-threshold="80"
      @refresherrefresh="onRefresherRefresh"
      @scrolltolower="onLoadMore"
      @scroll="onScroll"
    >
      <view class="menu-list">
        <view class="menu-item" @click="go('/pages/contacts/new-friends')">
          <image class="menu-icon" src="/static/icons/menu-new-friend.svg" mode="aspectFit" />
          <text class="menu-text">新的朋友</text>
          <image class="arrow" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
        </view>
        <view class="menu-item" @click="go('/pages/contacts/tags')">
          <image class="menu-icon" src="/static/icons/menu-tag.svg" mode="aspectFit" />
          <text class="menu-text">标签</text>
          <image class="arrow" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
        </view>
        <view class="menu-item" @click="go('/pages/contacts/groups')">
          <image class="menu-icon" src="/static/icons/menu-group.svg" mode="aspectFit" />
          <text class="menu-text">群聊天</text>
          <image class="arrow" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
        </view>
      </view>

      <view v-if="groups.length" class="group-band">
        <view
          v-for="g in groups.slice(0, 5)"
          :key="g.id"
          class="group-card"
          @click="openGroupChat(g)"
        >
          <image class="group-avatar" :src="g.avatar || '/static/icons/menu-group.svg'" mode="aspectFill" />
          <text class="group-name">{{ g.name }}</text>
          <text v-if="g.status === 'dismissed'" class="dissolved-tag">已解散</text>
        </view>
      </view>
      <view class="section-divider" />

      <view class="section-head">
        <text class="section-count">联络人 ({{ contactTotal }})</text>
        <view class="sort-wrap" @click.stop="showSort = !showSort">
          <text class="sort">{{ sortLabel }}</text>
          <image class="sort-caret" src="/static/icons/icon-caret.svg" mode="aspectFit" />
          <view v-if="showSort" class="popup-menu sort-menu">
            <view
              class="popup-item"
              :class="{ active: sortKey === 'recent' }"
              @click="setSort('recent')"
            >最近加入(默认)</view>
            <view
              class="popup-item"
              :class="{ active: sortKey === 'name' }"
              @click="setSort('name')"
            >名字</view>
            <view
              class="popup-item"
              :class="{ active: sortKey === 'chat' }"
              @click="setSort('chat')"
            >最近聊天</view>
          </view>
        </view>
      </view>

      <view
        v-for="c in contacts"
        :key="c.id"
        class="contact-row"
        @click="openContact(c)"
      >
        <image class="avatar" :src="c.avatar" mode="aspectFill" />
        <text class="name">{{ listName(c) }}</text>
      </view>
      <view v-if="contactsLoading" class="list-status">加载中</view>
      <view v-else-if="!contacts.length" class="list-status">暂无联络人</view>
      <view v-else-if="!contactHasMore" class="list-status">没有更多了</view>
    </scroll-view>

    <ImTabBar current="contacts" />
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(144rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.header {
  background: #fff;
}

.header-row {
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
  width: 48rpx;
  height: 48rpx;
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
  top: 64rpx;
  right: 0;
  min-width: 288rpx;
  padding: 16rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 20rpx 30rpx -6rpx rgba(0, 0, 0, 0.1), 0 8rpx 12rpx -8rpx rgba(0, 0, 0, 0.1);
  z-index: 30;
}

.sort-menu {
  right: 0;
  left: auto;
  top: 48rpx;
  min-width: 320rpx;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.1);
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

.body {
  flex: 1;
  min-height: 0;
  /* #ifdef H5 */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* #endif */
}

.menu-list {
  background: #fff;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 96rpx;
  padding: 0 40rpx;
  box-sizing: border-box;
}

.menu-icon {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.menu-text {
  flex: 1;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
}

.arrow {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.group-band {
  background: #f3f4f7;
  padding: 16rpx 40rpx;
  margin-bottom: 16rpx;
}

.group-card {
  display: flex;
  align-items: center;
  gap: 32rpx;
  padding: 16rpx;
  background: #fff;
  border-radius: 8rpx;
  box-sizing: border-box;
  margin-bottom: 16rpx;
}

.group-card:last-child {
  margin-bottom: 0;
}

.group-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.group-name {
  flex: 1;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dissolved-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #999;
  border: 1rpx solid #c9cdd4;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-left: 12rpx;
}

.section-divider {
  height: 48rpx;
  margin: 0 0 16rpx;
  background: #f3f4f7;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 48rpx;
  margin: 0 40rpx 16rpx;
}

.section-count {
  color: #212121;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 48rpx;
}

.sort-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.sort {
  color: #626e8d;
  font-size: 24rpx;
  line-height: 40rpx;
}

.sort-caret {
  width: 16rpx;
  height: 16rpx;
}

.contact-row {
  display: flex;
  align-items: center;
  gap: 32rpx;
  height: 128rpx;
  padding: 0 40rpx;
  background: #fff;
  box-sizing: border-box;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-status {
  padding: 24rpx 0 48rpx;
  text-align: center;
  font-size: 24rpx;
  color: #8a8f9c;
}
</style>
