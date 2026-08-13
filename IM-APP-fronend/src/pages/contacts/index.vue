<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImTabBar from '@/components/ImTabBar.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useTabBar } from '@/composables/useTabBar'
import type { Contact } from '@/types'

useAuthGuard()
useTabBar()

const contactStore = useContactStore()
const { contacts, groups } = storeToRefs(contactStore)
const keyword = ref('')
const sortKey = ref<'recent' | 'name' | 'chat'>('recent')
const showSort = ref(false)
const showAddMenu = ref(false)

const sortLabel = computed(() => {
  if (sortKey.value === 'name') return '名字'
  if (sortKey.value === 'chat') return '最近聊天'
  return '最近加入(默认)'
})

const featuredGroup = computed(() => groups.value[0] ?? null)

const filteredContacts = computed(() => {
  let list = [...contacts.value]
  const k = keyword.value.trim()
  if (k) {
    list = list.filter((c) => listName(c).includes(k) || (c.publicId || '').includes(k))
  }
  if (sortKey.value === 'name') {
    list.sort((a, b) => listName(a).localeCompare(listName(b), 'zh-CN'))
  }
  return list
})

function listName(c: Contact) {
  return c.remark?.trim() || c.nickname
}

// tabBar 页会常驻，onMounted 只跑一次，切回来必须重新拉才能看到新加的好友
onShow(() => {
  contactStore.loadAll()
})

function go(url: string) {
  showAddMenu.value = false
  showSort.value = false
  uni.navigateTo({ url })
}

function openContact(c: Contact) {
  go(`/pages/contacts/friend-detail?id=${c.id}`)
}

function openFeaturedGroup() {
  const g = featuredGroup.value
  if (!g) return
  go(`/pages/contacts/groups`)
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
        <image class="icon-plus" src="/static/icons/icon-plus.svg" mode="aspectFit" />
        <view v-if="showAddMenu" class="popup-menu">
          <view class="popup-item" @click="go('/pages/contacts/add-friend')">
            <image class="popup-icon" src="/static/icons/menu-add-friend.svg" mode="aspectFit" />
            <text>添加朋友</text>
          </view>
          <view class="popup-item" @click="go('/pages/contacts/scan')">
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

    <scroll-view scroll-y class="body">
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

      <view v-if="featuredGroup" class="featured-band">
        <view class="featured-card" @click="openFeaturedGroup">
          <image class="featured-avatar" :src="featuredGroup.avatar" mode="aspectFill" />
          <text class="featured-name">{{ featuredGroup.name }}</text>
        </view>
      </view>
      <view v-else class="section-divider" />

      <view class="section-head">
        <text class="section-count">联络人 ({{ filteredContacts.length }})</text>
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
        v-for="c in filteredContacts"
        :key="c.id"
        class="contact-row"
        @click="openContact(c)"
      >
        <image class="avatar" :src="c.avatar" mode="aspectFill" />
        <text class="name">{{ listName(c) }}</text>
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
  height: 96rpx;
  padding: 0 40rpx;
  background: #fff;
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

.featured-band {
  background: #f3f4f7;
  padding: 16rpx 40rpx;
  margin-bottom: 16rpx;
}

.featured-card {
  display: flex;
  align-items: center;
  gap: 32rpx;
  padding: 8rpx;
  background: #fff;
  border-radius: 8rpx;
  box-sizing: border-box;
}

.featured-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.featured-name {
  flex: 1;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
