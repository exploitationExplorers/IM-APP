<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import type { Contact } from '@/types'

useAuthGuard()
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
        <text class="icon-btn">＋</text>
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
          <view class="menu-icon orange">
            <text class="menu-icon-text">＋</text>
          </view>
          <text class="menu-text">新的朋友</text>
          <text class="arrow">›</text>
        </view>
        <view class="menu-item" @click="go('/pages/contacts/tags')">
          <view class="menu-icon pink">
            <text class="menu-icon-text">🏷</text>
          </view>
          <text class="menu-text">标签</text>
          <text class="arrow">›</text>
        </view>
        <view class="menu-item" @click="go('/pages/contacts/groups')">
          <view class="menu-icon blue">
            <text class="menu-icon-text">👥</text>
          </view>
          <text class="menu-text">群聊天</text>
          <text class="arrow">›</text>
        </view>
      </view>

      <view class="section-divider" />

      <view class="section-head">
        <text class="section-count">联络人 ({{ filteredContacts.length }})</text>
        <view class="sort-wrap" @click.stop="showSort = !showSort">
          <text class="sort">{{ sortLabel }}</text>
          <text class="sort-caret">▾</text>
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
  background: #fff;
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
  min-width: 240rpx;
  background: #fff;
  border-radius: 12rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
  z-index: 30;
  overflow: hidden;
}

.sort-menu {
  right: 0;
  left: auto;
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
  padding: 24rpx 28rpx;
}

.menu-icon {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
}

.menu-icon-text {
  font-size: 32rpx;
  line-height: 1;
}

.orange { background: #ff8a3d; }
.pink { background: #ff6b9d; }
.blue { background: #3b7bff; }

.menu-text {
  flex: 1;
  font-size: 30rpx;
  color: #212121;
}

.arrow {
  color: #c8ccd6;
  font-size: 36rpx;
}

.section-divider {
  height: 16rpx;
  background: #f5f6f8;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 28rpx;
}

.section-count {
  color: #212121;
  font-size: 28rpx;
  font-weight: 600;
}

.sort-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.sort,
.sort-caret {
  color: #8a8f9c;
  font-size: 24rpx;
}

.contact-row {
  display: flex;
  align-items: center;
  padding: 20rpx 28rpx;
  background: #fff;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background: #eee;
}

.name {
  flex: 1;
  font-size: 28rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
