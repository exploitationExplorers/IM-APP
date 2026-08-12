<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useMassSendStore, type MassTarget } from '@/stores/massSend'

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
const chatStore = useChatStore()
const contactStore = useContactStore()
const massStore = useMassSendStore()

const keyword = ref('')
const active = ref<'recent' | 'contacts' | 'groups' | 'tags'>('recent')
const from = ref('')

onLoad((q) => {
  from.value = String(q?.from || '')
})

onShow(async () => {
  if (!chatStore.conversations.length) {
    await chatStore.loadConversations().catch(() => undefined)
  }
  if (!contactStore.contacts.length && !contactStore.groups.length) {
    await contactStore.loadAll().catch(() => undefined)
  }
})

const selected = computed(() => massStore.selectedTargets)
const selectedCount = computed(() => selected.value.length)

const selectedLabel = computed(() => `已选(${selectedCount.value})`)
const confirmLabel = computed(() => `确认(${selectedCount.value})`)

const listRecent = computed<MassTarget[]>(() =>
  chatStore.conversations.map((c) => ({
    id: `r_${c.id}`,
    type: 'contact',
    name: c.title,
    avatar: c.avatar,
  })),
)

const listContacts = computed<MassTarget[]>(() =>
  contactStore.contacts.map((c) => ({
    id: `c_${c.id}`,
    type: 'contact',
    name: c.remark || c.nickname,
    avatar: c.avatar,
  })),
)

const listGroups = computed<MassTarget[]>(() =>
  contactStore.groups.map((g) => ({
    id: `g_${g.id}`,
    type: 'group',
    name: g.name,
    avatar: g.avatar,
  })),
)

const listTags = computed<MassTarget[]>(() => {
  const tagSet = new Set<string>()
  contactStore.contacts.forEach((c) => {
    ;(c.tags || []).forEach((t) => tagSet.add(t))
  })
  const tags = Array.from(tagSet)
  if (!tags.length) {
    return [
      { id: 't_常用', type: 'tag', name: '常用', avatar: '/static/avatar-1.png' },
      { id: 't_同事', type: 'tag', name: '同事', avatar: '/static/avatar-1.png' },
      { id: 't_家人', type: 'tag', name: '家人', avatar: '/static/avatar-1.png' },
    ]
  }
  return tags.map((t) => ({ id: `t_${t}`, type: 'tag', name: t, avatar: '/static/avatar-1.png' }))
})

const currentRaw = computed<MassTarget[]>(() => {
  if (active.value === 'recent') return listRecent.value
  if (active.value === 'contacts') return listContacts.value
  if (active.value === 'groups') return listGroups.value
  return listTags.value
})

const currentList = computed<MassTarget[]>(() => {
  const k = keyword.value.trim()
  if (!k) return currentRaw.value
  return currentRaw.value.filter((i) => i.name.includes(k))
})

const currentIds = computed(() => currentList.value.map((i) => i.id))
const allSelectedInView = computed(() => {
  const ids = currentIds.value
  if (!ids.length) return false
  return ids.every((id) => selected.value.some((s) => s.id === id))
})

function goBack() {
  uni.navigateBack()
}

function isSelected(item: MassTarget) {
  return selected.value.some((s) => s.id === item.id)
}

function toggle(item: MassTarget) {
  if (isSelected(item)) {
    massStore.setSelectedTargets(selected.value.filter((s) => s.id !== item.id))
  } else {
    massStore.setSelectedTargets([...selected.value, item])
  }
}

function removeSelected(id: string) {
  massStore.removeSelected(id)
}

function toggleSelectAll() {
  const ids = currentIds.value
  if (!ids.length) return
  if (allSelectedInView.value) {
    massStore.setSelectedTargets(selected.value.filter((s) => !ids.includes(s.id)))
  } else {
    const map = new Map<string, MassTarget>()
    selected.value.forEach((s) => map.set(s.id, s))
    currentList.value.forEach((s) => map.set(s.id, s))
    massStore.setSelectedTargets(Array.from(map.values()))
  }
}

function onConfirm() {
  if (!selectedCount.value) {
    uni.showToast({ title: '请选择联系人', icon: 'none' })
    return
  }
  if (from.value === 'compose' || from.value === 'targets') {
    uni.navigateBack()
    return
  }
  uni.navigateTo({ url: '/pages/mine/mass-compose' })
}
</script>

<template>
  <view class="page">
    <view class="nav-bar-wrap">
      <view class="status-bar" :style="{ height: statusBarHeight + 'px' }"></view>
      <view class="nav-bar">
        <view class="nav-left">
          <text class="back-icon" @click="goBack">‹</text>
        </view>
        <view class="nav-center">
          <text class="title">选择联系人</text>
        </view>
        <view class="nav-right">
          <view class="confirm-btn" :class="{ disabled: selectedCount === 0 }" @click="onConfirm">
            {{ confirmLabel }}
          </view>
        </view>
      </view>
    </view>

    <view class="selected-bar">
      <text class="selected-label">{{ selectedLabel }}</text>
    </view>

    <scroll-view scroll-x class="selected-scroll" show-scrollbar="false">
      <view class="selected-row">
        <view v-for="s in selected" :key="s.id" class="sel-item">
          <view class="sel-avatar-wrap">
            <image class="sel-avatar" :src="s.avatar" mode="aspectFill" />
            <view class="sel-close" @click.stop="removeSelected(s.id)">×</view>
          </view>
          <text class="sel-name">{{ s.name }}</text>
        </view>
      </view>
    </scroll-view>

    <view class="search">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          v-model="keyword"
          class="search-input"
          placeholder="搜索"
          placeholder-style="color:#B0B0B0"
        />
      </view>
    </view>

    <view class="tabs">
      <view class="tab" :class="{ active: active === 'recent' }" @click="active = 'recent'">最近聊天</view>
      <view class="tab" :class="{ active: active === 'contacts' }" @click="active = 'contacts'">联系人</view>
      <view class="tab" :class="{ active: active === 'groups' }" @click="active = 'groups'">群组</view>
      <view class="tab" :class="{ active: active === 'tags' }" @click="active = 'tags'">标签</view>
    </view>

    <view class="select-all" @click="toggleSelectAll">
      <text class="select-all-text">全选</text>
      <view class="select-all-icon" :class="{ on: allSelectedInView }">
        <text v-if="allSelectedInView" class="select-all-tick">✓</text>
      </view>
    </view>

    <scroll-view scroll-y class="list">
      <view v-for="item in currentList" :key="item.id" class="row" @click="toggle(item)">
        <image class="avatar" :src="item.avatar" mode="aspectFill" />
        <text class="name">{{ item.name }}</text>
        <view class="check" :class="{ on: isSelected(item) }">
          <text v-if="isSelected(item)" class="check-tick">✓</text>
        </view>
      </view>
      <view v-if="!currentList.length" class="empty">暂无数据</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}

.nav-bar-wrap {
  background: #ffffff;
}

.nav-bar {
  height: 96rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  box-sizing: border-box;
}

.nav-left,
.nav-right {
  width: 200rpx;
  display: flex;
  align-items: center;
}

.nav-right {
  justify-content: flex-end;
}

.nav-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.back-icon {
  font-size: 52rpx;
  color: #111;
  line-height: 1;
  padding: 8rpx 12rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.confirm-btn {
  height: 56rpx;
  padding: 0 20rpx;
  border-radius: 10rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-btn.disabled {
  opacity: 0.5;
}

.selected-bar {
  padding: 18rpx 32rpx 10rpx;
}

.selected-label {
  font-size: 26rpx;
  color: #8a8f9c;
}

.selected-scroll {
  padding: 0 18rpx 14rpx;
  box-sizing: border-box;
}

.selected-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
}

.sel-item {
  width: 120rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}

.sel-avatar-wrap {
  position: relative;
  width: 90rpx;
  height: 90rpx;
}

.sel-avatar {
  width: 90rpx;
  height: 90rpx;
  border-radius: 50%;
  background: #f3f4f7;
}

.sel-close {
  position: absolute;
  right: -6rpx;
  top: -6rpx;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sel-name {
  max-width: 120rpx;
  font-size: 22rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search {
  padding: 0 32rpx 10rpx;
  box-sizing: border-box;
}

.search-box {
  height: 72rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  display: flex;
  align-items: center;
  padding: 0 18rpx;
  gap: 12rpx;
}

.search-icon {
  font-size: 28rpx;
  color: #8a8f9c;
}

.search-input {
  flex: 1;
  height: 72rpx;
  font-size: 28rpx;
}

.tabs {
  display: flex;
  padding: 10rpx 32rpx 0;
  gap: 60rpx;
}

.tab {
  font-size: 28rpx;
  color: #212121;
  position: relative;
  padding-bottom: 16rpx;
}

.tab.active {
  color: #0a2fc2;
  font-weight: 700;
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 96rpx;
  height: 6rpx;
  background: #0a2fc2;
  border-radius: 4rpx;
}

.select-all {
  padding: 12rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12rpx;
}

.select-all-text {
  font-size: 26rpx;
  color: #8a8f9c;
}

.select-all-icon {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 2rpx solid #c8ccd6;
  background: #ffffff;
  color: #ffffff;
  font-size: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.select-all-icon.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.select-all-tick {
  color: #ffffff;
  font-size: 24rpx;
  line-height: 1;
}

.list {
  flex: 1;
  height: 0;
  background: #ffffff;
}

.row {
  display: flex;
  align-items: center;
  padding: 22rpx 32rpx;
  gap: 20rpx;
  box-sizing: border-box;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #f3f4f7;
}

.name {
  flex: 1;
  font-size: 30rpx;
  color: #212121;
}

.check {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 4rpx solid #0a2fc2;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.check.on {
  background: #0a2fc2;
}

.check-tick {
  color: #fff;
  font-size: 26rpx;
  line-height: 1;
}

.empty {
  padding: 60rpx 0;
  text-align: center;
  color: #8a8f9c;
  font-size: 26rpx;
}
</style>
