<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'

useAuthGuard()
const contactStore = useContactStore()
const keyword = ref('')

const visibleGroups = computed(() => {
  if (contactStore.groupsExpanded) return contactStore.groups
  return contactStore.groups.slice(0, 3)
})

const filteredContacts = computed(() => {
  const list = contactStore.contacts
  if (!keyword.value.trim()) return list
  const k = keyword.value.trim()
  return list.filter((c) => c.nickname.includes(k))
})

onMounted(() => {
  contactStore.loadAll()
})

function go(url: string) {
  uni.navigateTo({ url })
}

function openContact(id: string, nickname: string, avatar: string) {
  contactStore.openChatWithContact(id, nickname, avatar)
}

function onAdd() {
  uni.showActionSheet({
    itemList: ['添加朋友', '创建群聊'],
    success: (res) => {
      if (res.tapIndex === 0) go('/pages/contacts/add-friend')
      if (res.tapIndex === 1) go('/pages/group/create')
    },
  })
}
</script>

<template>
  <view class="page">
    <view class="header">
      <text class="title">通讯录</text>
      <view class="icon-btn" @click="onAdd">＋</view>
    </view>

    <AppSearchBar v-model="keyword" />

    <scroll-view scroll-y class="body">
      <view class="menu-list">
        <view class="menu-item" @click="go('/pages/contacts/new-friends')">
          <view class="menu-icon orange">＋</view>
          <text class="menu-text">新的朋友</text>
          <text class="arrow">›</text>
        </view>
        <view class="menu-item" @click="go('/pages/contacts/tags')">
          <view class="menu-icon pink">🏷</view>
          <text class="menu-text">标签</text>
          <text class="arrow">›</text>
        </view>
        <view class="menu-item" @click="go('/pages/contacts/groups')">
          <view class="menu-icon blue">👥</view>
          <text class="menu-text">群聊天</text>
          <text class="arrow">›</text>
        </view>
      </view>

      <view class="card">
        <view
          v-for="g in visibleGroups"
          :key="g.id"
          class="group-row"
          @click="go('/pages/contacts/groups')"
        >
          <image class="avatar" :src="g.avatar" mode="aspectFill" />
          <text class="name">{{ g.name }}</text>
        </view>
        <view class="expand" @click="contactStore.toggleGroupsExpanded()">
          {{ contactStore.groupsExpanded ? '收起群聊' : `展开所有群聊(${contactStore.groups.length})` }}
        </view>
      </view>

      <view class="section-head">
        <text>联络人({{ filteredContacts.length }})</text>
        <text class="sort">最近加入(默认) ▾</text>
      </view>

      <view
        v-for="c in filteredContacts"
        :key="c.id"
        class="contact-row"
        @click="openContact(c.id, c.nickname, c.avatar)"
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
  background: #f5f6f8;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 88rpx 28rpx 16rpx;
  background: #fff;
}

.title {
  font-size: 44rpx;
  font-weight: 700;
}

.icon-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
}

.body {
  flex: 1;
  height: 0;
}

.menu-list {
  background: #fff;
  margin-bottom: 16rpx;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f3f3f3;
}

.menu-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
  font-size: 28rpx;
}

.orange { background: #ff8a3d; }
.pink { background: #ff6b9d; }
.blue { background: #3b7bff; }

.menu-text {
  flex: 1;
  font-size: 30rpx;
}

.arrow {
  color: #ccc;
  font-size: 36rpx;
}

.card {
  background: #fff;
  margin: 0 20rpx 16rpx;
  border-radius: 16rpx;
  padding: 8rpx 0;
}

.group-row,
.contact-row {
  display: flex;
  align-items: center;
  padding: 20rpx 28rpx;
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
  color: #222;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand {
  text-align: center;
  color: #2b5cff;
  font-size: 26rpx;
  padding: 16rpx 0 24rpx;
}

.section-head {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 28rpx;
  color: #666;
  font-size: 24rpx;
}

.sort {
  color: #999;
}

.contact-row {
  background: #fff;
  border-bottom: 1rpx solid #f3f3f3;
}
</style>
