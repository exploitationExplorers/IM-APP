<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import { inviteGroupMembers, fetchGroupMembers } from '@/api/group'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useContactStore } from '@/stores/contact'
import { useGroupStore } from '@/stores/group'
import { APP_CONFIG } from '@/config'
import ImNavBar from '@/components/ImNavBar.vue'
import type { Contact, ContactListSort } from '@/types'

useAuthGuard()

const contactStore = useContactStore()
const groupStore = useGroupStore()
const { contacts } = storeToRefs(contactStore)

const groupId = ref('')
const keyword = ref('')
const sortKey = ref<'recent' | 'name' | 'chat'>('recent')
const showSort = ref(false)
const memberIds = ref<Set<string>>(new Set())
const selected = ref<Set<string>>(new Set())
const selectedById = ref<Map<string, Contact>>(new Map())
const saving = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const sortLabel = computed(() => {
  if (sortKey.value === 'name') return '名字'
  if (sortKey.value === 'chat') return '最近聊天'
  return '最近加入(默认)'
})

const listSort = computed<ContactListSort>(() => (sortKey.value === 'name' ? 'name' : 'recent'))

const candidates = computed(() => contacts.value.filter((c) => !memberIds.value.has(c.id)))

const selectedCount = computed(() => selected.value.size)

const selectedContacts = computed(() => [...selectedById.value.values()])

const allSelected = computed(
  () => candidates.value.length > 0 && candidates.value.every((c) => selected.value.has(c.id)),
)

const canConfirm = computed(() => selectedCount.value > 0 && !saving.value)

function contactAvatar(url: string) {
  return url || APP_CONFIG.defaultAvatarUrl
}

async function refreshContacts() {
  return contactStore.reloadContacts({
    keyword: keyword.value,
    sort: listSort.value,
  })
}

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  try {
    const [members] = await Promise.all([
      fetchGroupMembers(groupId.value),
      refreshContacts(),
    ])
    memberIds.value = new Set(members.map((m) => m.id))
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void refreshContacts()
  }, 300)
})

function goBack() {
  uni.navigateBack()
}

function isSelected(id: string) {
  return selected.value.has(id)
}

function toggle(c: Contact) {
  const ids = new Set(selected.value)
  const map = new Map(selectedById.value)
  if (ids.has(c.id)) {
    ids.delete(c.id)
    map.delete(c.id)
  } else {
    ids.add(c.id)
    map.set(c.id, c)
  }
  selected.value = ids
  selectedById.value = map
}

function removeSelected(id: string) {
  const ids = new Set(selected.value)
  const map = new Map(selectedById.value)
  ids.delete(id)
  map.delete(id)
  selected.value = ids
  selectedById.value = map
}

function toggleAll() {
  const ids = new Set(selected.value)
  const map = new Map(selectedById.value)
  if (allSelected.value) {
    candidates.value.forEach((c) => {
      ids.delete(c.id)
      map.delete(c.id)
    })
  } else {
    candidates.value.forEach((c) => {
      ids.add(c.id)
      map.set(c.id, c)
    })
  }
  selected.value = ids
  selectedById.value = map
}

function setSort(key: 'recent' | 'name' | 'chat') {
  sortKey.value = key
  showSort.value = false
  void refreshContacts()
}

async function onConfirm() {
  if (!canConfirm.value) return
  saving.value = true
  uni.showLoading({ title: '邀请中...', mask: true })
  try {
    const res = await inviteGroupMembers(groupId.value, [...selected.value])
    uni.hideLoading()
    uni.showToast({
      title: res.invitedCount > 0 ? `已邀请 ${res.invitedCount} 人` : '所选好友已在群中',
      icon: res.invitedCount > 0 ? 'success' : 'none',
    })
    if (res.invitedCount > 0) {
      await groupStore.loadDetail(groupId.value).catch(() => undefined)
      setTimeout(() => uni.navigateBack(), 400)
    }
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page" @click="showSort = false">
    <ImNavBar title="选择联络人" @back="goBack">
      <template #right>
        <view class="confirm-btn" :class="{ enabled: canConfirm }" @click="onConfirm">
          {{ canConfirm ? `确认(${selectedCount})` : '确认' }}
        </view>
      </template>
    </ImNavBar>

    <view v-if="selectedCount > 0" class="chips">
      <view
        v-for="c in selectedContacts"
        :key="c.id"
        class="chip"
        @click.stop="removeSelected(c.id)"
      >
        <image class="chip-avatar" :src="contactAvatar(c.avatar)" mode="aspectFill" />
        <text class="chip-name">{{ c.nickname }}</text>
      </view>
    </view>

    <view class="search-wrap">
      <view class="search-box">
        <text class="search-glyph">⌕</text>
        <input
          class="search-input"
          v-model="keyword"
          placeholder="搜索"
          placeholder-class="search-ph"
        />
      </view>
    </view>

    <view class="section-head">
      <text class="section-count">联络人 ({{ candidates.length }})</text>
      <view class="head-right">
        <view class="sort-wrap" @click.stop="showSort = !showSort">
          <text class="sort">{{ sortLabel }}</text>
          <image class="sort-caret" src="/static/icons/icon-caret.svg" mode="aspectFit" />
          <view v-if="showSort" class="sort-menu">
            <view
              class="sort-item"
              :class="{ active: sortKey === 'recent' }"
              @click="setSort('recent')"
            >最近加入(默认)</view>
            <view
              class="sort-item"
              :class="{ active: sortKey === 'name' }"
              @click="setSort('name')"
            >名字</view>
            <view
              class="sort-item"
              :class="{ active: sortKey === 'chat' }"
              @click="setSort('chat')"
            >最近聊天</view>
          </view>
        </view>
        <text class="select-all" @click.stop="toggleAll">全选</text>
      </view>
    </view>

    <scroll-view scroll-y class="list" :lower-threshold="80" @scrolltolower="contactStore.loadMoreContacts">
      <view
        v-for="c in candidates"
        :key="c.id"
        class="row"
        @click="toggle(c)"
      >
        <image class="avatar" :src="contactAvatar(c.avatar)" mode="aspectFill" />
        <text class="name">{{ c.nickname }}</text>
        <view class="check" :class="{ on: isSelected(c.id) }" />
      </view>
      <view v-if="!candidates.length" class="empty">暂无可邀请的好友</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.confirm-btn {
  min-width: 104rpx;
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 8rpx;
  background: #e1e3ea;
  color: #848ea9;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.confirm-btn.enabled {
  background: #0a2fc2;
  color: #fff;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  padding: 8rpx 40rpx 16rpx;
}

.chip {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 4rpx 12rpx 4rpx 4rpx;
  background: #f3f4f7;
  border-radius: 999rpx;
}

.chip-avatar {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #eee;
}

.chip-name {
  font-size: 24rpx;
  color: #212121;
  max-width: 160rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-wrap {
  padding: 8rpx 40rpx 16rpx;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 72rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
}

.search-glyph {
  color: #626e8d;
  font-size: 30rpx;
}

.search-input {
  flex: 1;
  height: 72rpx;
  font-size: 28rpx;
  color: #212121;
}

.search-ph {
  color: #626e8d;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 48rpx;
  margin: 8rpx 40rpx 16rpx;
}

.section-count {
  font-size: 28rpx;
  font-weight: 700;
  color: #212121;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 20rpx;
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
}

.sort-caret {
  width: 16rpx;
  height: 16rpx;
}

.sort-menu {
  position: absolute;
  top: 48rpx;
  right: 0;
  min-width: 320rpx;
  padding: 16rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.1);
  z-index: 20;
}

.sort-item {
  padding: 16rpx 32rpx;
  font-size: 28rpx;
  color: #212121;
  text-align: center;
  border-radius: 8rpx;
}

.sort-item.active {
  color: #0a2fc2;
}

.select-all {
  font-size: 28rpx;
  color: #626e8d;
}

.list {
  flex: 1;
  height: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 32rpx;
  height: 128rpx;
  padding: 0 40rpx;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  border: 2rpx solid #e1e3ea;
  background: #f3f4f7;
  box-sizing: border-box;
  flex-shrink: 0;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
  position: relative;
}

.check.on::after {
  content: '';
  position: absolute;
  left: 14rpx;
  top: 8rpx;
  width: 12rpx;
  height: 22rpx;
  border: 4rpx solid #fff;
  border-top: 0;
  border-left: 0;
  transform: rotate(45deg);
}

.empty {
  padding: 120rpx 20rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
