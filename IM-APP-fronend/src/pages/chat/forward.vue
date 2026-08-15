<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useForwardStore } from '@/stores/forward'
import { APP_CONFIG } from '@/config'
import { safeBack } from '@/utils/nav'

type TabKey = 'recent' | 'contacts' | 'groups' | 'tags'

interface ForwardTarget {
  id: string
  kind: 'conversation' | 'contact' | 'group' | 'tag'
  name: string
  avatar: string
  conversationId?: string
  businessUserId?: string
  businessGroupId?: string
  tagName?: string
}

const chatStore = useChatStore()
const contactStore = useContactStore()
const forwardStore = useForwardStore()

const keyword = ref('')
const active = ref<TabKey>('recent')
const selected = ref<Map<string, ForwardTarget>>(new Map())
const sending = ref(false)

onLoad(async () => {
  if (!forwardStore.messageIds.length) {
    uni.showToast({ title: '没有可转发的消息', icon: 'none' })
    safeBack('/pages/chat/index')
    return
  }
  if (!chatStore.conversations.length) {
    await chatStore.loadConversations().catch(() => undefined)
  }
  if (!contactStore.contacts.length && !contactStore.groups.length) {
    await contactStore.loadDirectory().catch(() => undefined)
  }
})

const selectedCount = computed(() => selected.value.size)

const listRecent = computed<ForwardTarget[]>(() =>
  chatStore.conversations.map((c) => ({
    id: `r_${c.id}`,
    kind: 'conversation',
    name: c.title,
    avatar: c.avatar || APP_CONFIG.defaultAvatarUrl,
    conversationId: c.id,
  })),
)

const listContacts = computed<ForwardTarget[]>(() =>
  contactStore.contacts.map((c) => ({
    id: `c_${c.id}`,
    kind: 'contact',
    name: c.remark?.trim() || c.nickname,
    avatar: c.avatar || APP_CONFIG.defaultAvatarUrl,
    businessUserId: c.id,
  })),
)

const listGroups = computed<ForwardTarget[]>(() =>
  contactStore.groups.map((g) => ({
    id: `g_${g.id}`,
    kind: 'group',
    name: g.name,
    avatar: g.avatar || APP_CONFIG.defaultGroupAvatarUrl,
    businessGroupId: g.id,
    conversationId: g.conversationId,
  })),
)

const listTags = computed<ForwardTarget[]>(() => {
  const names = new Set<string>()
  contactStore.contacts.forEach((c) => {
    ;(c.tags || []).forEach((t) => names.add(t.name))
    ;(c.tagNames || []).forEach((t) => names.add(t))
  })
  return [...names].map((name) => ({
    id: `t_${name}`,
    kind: 'tag',
    name,
    avatar: APP_CONFIG.defaultAvatarUrl,
    tagName: name,
  }))
})

const currentRaw = computed(() => {
  if (active.value === 'recent') return listRecent.value
  if (active.value === 'contacts') return listContacts.value
  if (active.value === 'groups') return listGroups.value
  return listTags.value
})

const currentList = computed(() => {
  const k = keyword.value.trim()
  if (!k) return currentRaw.value
  return currentRaw.value.filter((i) => i.name.includes(k))
})

const allSelectedInView = computed(() => {
  const list = currentList.value
  return !!list.length && list.every((i) => selected.value.has(i.id))
})

function isSelected(id: string) {
  return selected.value.has(id)
}

function toggle(item: ForwardTarget) {
  const next = new Map(selected.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.set(item.id, item)
  selected.value = next
}

function toggleSelectAll() {
  const next = new Map(selected.value)
  if (allSelectedInView.value) {
    currentList.value.forEach((i) => next.delete(i.id))
  } else {
    currentList.value.forEach((i) => next.set(i.id, i))
  }
  selected.value = next
}

function expandTargets(): ForwardTarget[] {
  const result = new Map<string, ForwardTarget>()
  selected.value.forEach((item) => {
    if (item.kind !== 'tag' || !item.tagName) {
      result.set(item.id, item)
      return
    }
    const tagName = item.tagName
    contactStore.contacts
      .filter((c) => (c.tags || []).some((t) => t.name === tagName) || (c.tagNames || []).includes(tagName))
      .forEach((c) => {
        result.set(`c_${c.id}`, {
          id: `c_${c.id}`,
          kind: 'contact',
          name: c.remark?.trim() || c.nickname,
          avatar: c.avatar || APP_CONFIG.defaultAvatarUrl,
          businessUserId: c.id,
        })
      })
  })
  return [...result.values()]
}

async function resolveConversation(target: ForwardTarget) {
  if (target.conversationId) {
    const cached = chatStore.conversations.find((c) => c.id === target.conversationId)
    if (cached) return cached
  }
  if (target.kind === 'contact' && target.businessUserId) {
    return chatStore.enterConversation({ type: 'private', businessId: target.businessUserId })
  }
  if (target.kind === 'group' && target.businessGroupId) {
    return chatStore.enterConversation({ type: 'group', businessId: target.businessGroupId })
  }
  throw new Error(`无法转发到${target.name}`)
}

async function onSend() {
  const targets = expandTargets()
  if (!targets.length || sending.value) return
  sending.value = true
  uni.showLoading({ title: '传送中...' })
  let failed = 0
  try {
    for (const target of targets) {
      try {
        const conv = await resolveConversation(target)
        await chatStore.forwardToConversation(conv.id, forwardStore.messageIds)
      } catch {
        failed += 1
      }
    }
    uni.hideLoading()
    if (failed) {
      uni.showToast({ title: `完成，${failed} 人失败`, icon: 'none' })
    } else {
      uni.showToast({ title: '已传送', icon: 'success' })
    }
    forwardStore.clear()
    safeBack('/pages/chat/index')
  } finally {
    sending.value = false
    uni.hideLoading()
  }
}

function goBack() {
  safeBack('/pages/chat/index')
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="back" @click="goBack">‹</view>
      <text class="title">转发给</text>
      <view class="send" :class="{ disabled: selectedCount === 0 || sending }" @click="onSend">传送</view>
    </view>

    <view class="search">
      <input v-model="keyword" class="search-input" placeholder="搜索" placeholder-style="color:#B0B0B0" />
    </view>

    <view class="tabs">
      <view class="tab" :class="{ active: active === 'recent' }" @click="active = 'recent'">最近聊天</view>
      <view class="tab" :class="{ active: active === 'contacts' }" @click="active = 'contacts'">联络人</view>
      <view class="tab" :class="{ active: active === 'groups' }" @click="active = 'groups'">群组</view>
      <view class="tab" :class="{ active: active === 'tags' }" @click="active = 'tags'">标签</view>
    </view>

    <view v-if="active === 'contacts'" class="section-head">
      <text class="section-title">联络人 ({{ listContacts.length }})</text>
    </view>

    <view class="select-all" @click="toggleSelectAll">
      <text>全选</text>
      <view class="check" :class="{ on: allSelectedInView }">
        <text v-if="allSelectedInView">✓</text>
      </view>
    </view>

    <scroll-view scroll-y class="list">
      <view v-for="item in currentList" :key="item.id" class="row" @click="toggle(item)">
        <image class="avatar" :src="item.avatar" mode="aspectFill" />
        <text class="name">{{ item.name }}</text>
        <view class="check" :class="{ on: isSelected(item.id) }">
          <text v-if="isSelected(item.id)">✓</text>
        </view>
      </view>
      <view v-if="!currentList.length" class="empty">暂无数据</view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.nav {
  height: 96rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
}

.back {
  width: 72rpx;
  font-size: 52rpx;
  color: #111;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 36rpx;
  font-weight: 700;
  color: #111;
}

.send {
  min-width: 96rpx;
  height: 56rpx;
  padding: 0 18rpx;
  border-radius: 10rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send.disabled {
  opacity: 0.35;
  pointer-events: none;
}

.search {
  padding: 0 32rpx 12rpx;
}

.search-input {
  height: 72rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  padding: 0 24rpx;
  font-size: 28rpx;
}

.tabs {
  display: flex;
  padding: 8rpx 32rpx 0;
  gap: 48rpx;
}

.tab {
  font-size: 28rpx;
  color: #212121;
  padding-bottom: 16rpx;
  position: relative;
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

.section-head {
  padding: 16rpx 32rpx 0;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #111;
}

.select-all {
  padding: 16rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12rpx;
  font-size: 26rpx;
  color: #8a8f9c;
}

.list {
  flex: 1;
  height: 0;
}

.row {
  display: flex;
  align-items: center;
  padding: 22rpx 32rpx;
  gap: 20rpx;
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
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 3rpx solid #c8ccd6;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: #fff;
  font-size: 24rpx;
}

.check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  color: #8a8f9c;
  font-size: 26rpx;
}
</style>
