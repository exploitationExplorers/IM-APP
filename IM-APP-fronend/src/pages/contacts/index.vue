<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImTabBar from '@/components/ImTabBar.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useTabBar } from '@/composables/useTabBar'
import type { Contact } from '@/types'

useAuthGuard()
useTabBar()

const contactStore = useContactStore()
const keyword = ref('')
const sortKey = ref<'recent' | 'name' | 'chat'>('recent')
const showSort = ref(false)
const showAddMenu = ref(false)

const sortLabel = computed(() => {
  if (sortKey.value === 'name') return '名字'
  if (sortKey.value === 'chat') return '最近聊天'
  return '最近加入(默认)'
})

const filteredContacts = computed(() => {
  let list = [...contactStore.contacts]
  const k = keyword.value.trim()
  if (k) list = list.filter((c) => c.nickname.includes(k))
  if (sortKey.value === 'name') {
    list.sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-CN'))
  }
  return list
})

onMounted(() => {
  contactStore.loadAll()
})

function go(url: string) {
  showAddMenu.value = false
  showSort.value = false
  uni.navigateTo({ url })
}

function openContact(c: Contact) {
  contactStore.openChatWithContact(c.id, c.nickname, c.avatar)
}

function onAdd() {
  showSort.value = false
  showAddMenu.value = !showAddMenu.value
}

function setSort(key: 'recent' | 'name' | 'chat') {
  sortKey.value = key
  showSort.value = false
}

function closeMenus() {
  showAddMenu.value = false
  showSort.value = false
}
</script>

<template>
  <view class="page" @click="closeMenus">
    <view class="header">
      <text class="title">通讯录</text>
      <view class="add-wrap" @click.stop="onAdd">
        <text class="icon-plus">＋</text>
        <view v-if="showAddMenu" class="popup-menu">
          <view class="popup-item" @click="go('/pages/contacts/add-friend')">添加朋友</view>
          <view class="popup-item" @click="go('/pages/group/create')">创建群聊</view>
        </view>
      </view>
    </view>

    <AppSearchBar v-model="keyword" />

    <scroll-view scroll-y class="body">
      <view class="menu-list">
        <view class="menu-item" @click="go('/pages/contacts/new-friends')">
          <image class="menu-icon" src="/static/icons/menu-new-friend.svg" mode="aspectFit" />
          <text class="menu-text">新的朋友</text>
          <text class="arrow">›</text>
        </view>
        <view class="menu-item" @click="go('/pages/contacts/tags')">
          <image class="menu-icon" src="/static/icons/menu-tag.svg" mode="aspectFit" />
          <text class="menu-text">标签</text>
          <text class="arrow">›</text>
        </view>
        <view class="menu-item" @click="go('/pages/contacts/groups')">
          <image class="menu-icon" src="/static/icons/menu-group.svg" mode="aspectFit" />
          <text class="menu-text">群聊天</text>
          <text class="arrow">›</text>
        </view>
      </view>

      <view class="section-divider" />

      <view class="section-head">
        <text class="section-count">联络人 ({{ filteredContacts.length }})</text>
        <view class="sort-wrap" @click.stop="showSort = !showSort">
          <text class="sort">{{ sortLabel }}</text>
          <view class="sort-caret" />
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
        v-for="c in filteredContacts"
        :key="c.id"
        class="contact-row"
        @click="openContact(c)"
      >
        <image class="avatar" :src="c.avatar" mode="aspectFill" />
        <text class="name">{{ c.nickname }}</text>
      </view>
    </scroll-view>

    <ImTabBar current="contacts" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(144rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 40rpx 8rpx;
  background: #fff;
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
  font-size: 44rpx;
  color: #212121;
  line-height: 1;
  font-weight: 300;
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

.sort-menu {
  right: 0;
  left: auto;
  top: 48rpx;
  min-width: 280rpx;
}

.popup-item {
  padding: 16rpx 32rpx;
  font-size: 28rpx;
  color: #212121;
  white-space: nowrap;
  border-radius: 8rpx;
}

.popup-item.active {
  color: #0a2fc2;
}

.body {
  flex: 1;
  height: 0;
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
  color: #c8ccd6;
  font-size: 36rpx;
  line-height: 1;
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
  margin: 16rpx 40rpx 16rpx;
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
  color: #8a8f9c;
  font-size: 24rpx;
  line-height: 40rpx;
}

.sort-caret {
  width: 0;
  height: 0;
  border-left: 8rpx solid transparent;
  border-right: 8rpx solid transparent;
  border-top: 10rpx solid #8a8f9c;
  margin-left: 4rpx;
}

.contact-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 40rpx;
  background: #fff;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #eee;
  flex-shrink: 0;
}

.name {
  flex: 1;
  font-size: 32rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
