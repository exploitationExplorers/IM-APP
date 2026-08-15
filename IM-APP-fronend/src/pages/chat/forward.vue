<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchContactTags } from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useForwardStore } from '@/stores/forward'
import type { ContactTagItem, FriendForwardPlan } from '@/types'
import { snapshotFromMessage } from '@/utils/forwardSnapshot'
import { safeBack } from '@/utils/nav'
import { businessUserIdFromIM } from '@/utils/openim'

useAuthGuard()

type TabKey = 'recent' | 'contacts' | 'groups' | 'tags'

interface ForwardTarget {
  id: string
  kind: 'conversation' | 'contact' | 'group' | 'tag'
  name: string
  avatar: string
  conversationId?: string
  conversationType?: 'private' | 'group'
  businessUserId?: string
  businessGroupId?: string
  tagId?: string
}

const PAGE_SIZE = 80

const chatStore = useChatStore()
const contactStore = useContactStore()
const forwardStore = useForwardStore()

const keyword = ref('')
const active = ref<TabKey>('recent')
const selected = ref<Map<string, ForwardTarget>>(new Map())
const allFriendsSelected = ref(false)
const excludedFriendIds = ref<Set<string>>(new Set())
const tags = ref<ContactTagItem[]>([])
const sending = ref(false)
const visibleLimit = ref(PAGE_SIZE)

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
  tags.value = await fetchContactTags().catch(() => [])
})

watch([active, keyword], () => {
  visibleLimit.value = PAGE_SIZE
})

const selectedCount = computed(() => {
  let extra = 0
  if (allFriendsSelected.value) {
    extra = Math.max(0, listContacts.value.length - excludedFriendIds.value.size)
    selected.value.forEach((item) => {
      if (item.kind !== 'contact') extra += 1
    })
    return extra
  }
  return selected.value.size
})

const listRecent = computed<ForwardTarget[]>(() =>
  chatStore.conversations.map((c) => ({
    id: `r_${c.id}`,
    kind: c.type === 'group' ? 'group' : 'conversation',
    name: c.title,
    avatar: c.avatar || APP_CONFIG.defaultAvatarUrl,
    conversationId: c.id,
    conversationType: c.type,
    businessUserId: c.type === 'private' ? businessUserIdFromIM(c.peerUserId || '') || undefined : undefined,
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
    conversationType: 'group',
  })),
)

const listTags = computed<ForwardTarget[]>(() =>
  tags.value.map((t) => ({
    id: `t_${t.id}`,
    kind: 'tag',
    name: t.name,
    avatar: APP_CONFIG.defaultAvatarUrl,
    tagId: t.id,
  })),
)

const currentRaw = computed(() => {
  if (active.value === 'recent') return listRecent.value
  if (active.value === 'contacts') return listContacts.value
  if (active.value === 'groups') return listGroups.value
  return listTags.value
})

const filteredList = computed(() => {
  const k = keyword.value.trim()
  if (!k) return currentRaw.value
  return currentRaw.value.filter((i) => i.name.includes(k))
})

const currentList = computed(() => filteredList.value.slice(0, visibleLimit.value))

const allSelectedInView = computed(() => {
  if (active.value === 'contacts' && !keyword.value.trim()) {
    return allFriendsSelected.value && excludedFriendIds.value.size === 0 && !!listContacts.value.length
  }
  const list = filteredList.value
  return !!list.length && list.every((i) => isSelected(i))
})

function isSelected(item: ForwardTarget) {
  if (allFriendsSelected.value && item.kind === 'contact' && item.businessUserId) {
    return !excludedFriendIds.value.has(item.businessUserId)
  }
  return selected.value.has(item.id)
}

function toggle(item: ForwardTarget) {
  if (allFriendsSelected.value && item.kind === 'contact' && item.businessUserId) {
    const next = new Set(excludedFriendIds.value)
    if (next.has(item.businessUserId)) next.delete(item.businessUserId)
    else next.add(item.businessUserId)
    if (next.size >= listContacts.value.length) {
      allFriendsSelected.value = false
      excludedFriendIds.value = new Set()
      return
    }
    excludedFriendIds.value = next
    return
  }
  const next = new Map(selected.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.set(item.id, item)
  selected.value = next
}

function toggleSelectAll() {
  if (active.value === 'contacts' && !keyword.value.trim()) {
    if (allFriendsSelected.value && excludedFriendIds.value.size === 0) {
      allFriendsSelected.value = false
      excludedFriendIds.value = new Set()
      return
    }
    allFriendsSelected.value = true
    excludedFriendIds.value = new Set()
    const next = new Map(selected.value)
    next.forEach((item, id) => {
      if (item.kind === 'contact') next.delete(id)
    })
    selected.value = next
    return
  }
  const next = new Map(selected.value)
  if (allSelectedInView.value) {
    filteredList.value.forEach((i) => next.delete(i.id))
  } else {
    filteredList.value.forEach((i) => next.set(i.id, i))
  }
  selected.value = next
}

function loadMore() {
  if (visibleLimit.value < filteredList.value.length) {
    visibleLimit.value += PAGE_SIZE
  }
}

function collectPlan(): { friendPlan: FriendForwardPlan | null; groupTargets: ForwardTarget[] } {
  const groupTargets: ForwardTarget[] = []
  if (allFriendsSelected.value) {
    selected.value.forEach((item) => {
      if (item.kind === 'group') groupTargets.push(item)
    })
    return {
      friendPlan: { kind: 'all_friends', excludeUserIds: [...excludedFriendIds.value] },
      groupTargets,
    }
  }
  const userIds = new Set<string>()
  const tagIds: string[] = []
  selected.value.forEach((item) => {
    if (item.kind === 'group') {
      groupTargets.push(item)
      return
    }
    if (item.kind === 'tag' && item.tagId) {
      tagIds.push(item.tagId)
      return
    }
    if (item.businessUserId) userIds.add(item.businessUserId)
    else if (item.conversationId) groupTargets.push(item)
  })
  if (tagIds.length) {
    return {
      friendPlan: { kind: 'generate', selector: { mode: 'tags', tagIds }, extraUserIds: [...userIds] },
      groupTargets,
    }
  }
  if (userIds.size) {
    return { friendPlan: { kind: 'ids', userIds: [...userIds] }, groupTargets }
  }
  return { friendPlan: null, groupTargets }
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

function confirmSend(content: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content,
      confirmText: '传送',
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
    })
  })
}

function buildSources() {
  return forwardStore.messageIds.map((id) => {
    const raw = chatStore.getRawMessage(id)
    if (!raw) throw new Error('原消息不存在')
    return {
      sourceConversationId: forwardStore.sourceConversationId,
      sourceClientMsgId: raw.clientMsgID,
      sourceServerMsgId: raw.serverMsgID || undefined,
      snapshot: snapshotFromMessage(raw),
    }
  })
}

async function sendToGroups(groupTargets: ForwardTarget[]) {
  let failed = 0
  for (const target of groupTargets) {
    try {
      const conv = await resolveConversation(target)
      await chatStore.forwardToConversation(conv.id, forwardStore.messageIds)
    } catch {
      failed += 1
    }
  }
  return failed
}

async function onSend() {
  const { friendPlan, groupTargets } = collectPlan()
  if ((!friendPlan && !groupTargets.length) || sending.value) return
  const hint = friendPlan
    ? allFriendsSelected.value
      ? '确定转发给全部好友吗？'
      : `确定转发给选中的好友吗？${groupTargets.length ? `（含 ${groupTargets.length} 个群）` : ''}`
    : `确定转发给 ${groupTargets.length} 个群吗？`
  const ok = await confirmSend(hint)
  if (!ok) return
  sending.value = true
  uni.showLoading({ title: '提交中...' })
  try {
    const sources = buildSources()
    let taskIds: string[] = []
    if (friendPlan) {
      taskIds = await forwardStore.submitFriendPlan(sources, friendPlan)
    }
    const groupFailed = await sendToGroups(groupTargets)
    forwardStore.clear()
    uni.hideLoading()
    if (taskIds.length) {
      uni.redirectTo({
        url: `/pages/chat/forward-progress?taskIds=${encodeURIComponent(taskIds.join(','))}`,
      })
      return
    }
    if (groupFailed) {
      uni.showToast({ title: `完成，${groupFailed} 个群失败`, icon: 'none' })
    } else {
      uni.showToast({ title: '已传送', icon: 'success' })
    }
    safeBack('/pages/chat/index')
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: e instanceof Error ? e.message : '提交失败', icon: 'none' })
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

    <scroll-view scroll-y class="list" :lower-threshold="120" @scrolltolower="loadMore">
      <view v-for="item in currentList" :key="item.id" class="row" @click="toggle(item)">
        <image class="avatar" :src="item.avatar" mode="aspectFill" />
        <text class="name">{{ item.name }}</text>
        <view class="check" :class="{ on: isSelected(item) }">
          <text v-if="isSelected(item)">✓</text>
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
