<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchContactTags } from '@/api/contact'
import { resolveIMGroup, resolveIMGroupByIM } from '@/api/im'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useForwardStore } from '@/stores/forward'
import type { ContactTagItem, Conversation, FriendForwardPlan } from '@/types'
import { snapshotFromMessage } from '@/utils/forwardSnapshot'
import { safeBack } from '@/utils/nav'
import { businessUserIdFromIM } from '@/utils/openim'
import ImNavBar from '@/components/ImNavBar.vue'

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
const dismissedGroupIds = ref<Set<string>>(new Set())
const dismissedConversationKeys = ref<Set<string>>(new Set())
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function refreshDismissedForwardBlocklist() {
  await contactStore.loadGroups().catch(() => undefined)
  const dissolved = contactStore.groups.filter((g) => g.status === 'dismissed')
  const groupIds = new Set<string>()
  const convKeys = new Set<string>()
  await Promise.all(
    dissolved.map(async (g) => {
      groupIds.add(g.id)
      if (g.conversationId) convKeys.add(g.conversationId)
      try {
        const target = await resolveIMGroup(g.id)
        if (target.businessGroupId) groupIds.add(target.businessGroupId)
        if (target.imGroupId) {
          convKeys.add(target.imGroupId)
          convKeys.add(`sg_${target.imGroupId}`)
        }
      } catch {
        /* 解析失败时仍靠 status / 群名兜底 */
      }
    }),
  )
  dismissedGroupIds.value = groupIds
  dismissedConversationKeys.value = convKeys
}

function isDissolvedGroupConversation(c: Conversation): boolean {
  if (c.type !== 'group') return false
  if (dismissedConversationKeys.value.has(c.id)) return true
  if (c.groupId) {
    if (dismissedConversationKeys.value.has(c.groupId)) return true
    if (dismissedConversationKeys.value.has(`sg_${c.groupId}`)) return true
  }
  return contactStore.groups.some((g) => g.status === 'dismissed' && g.name === c.title)
}

function isDissolvedGroupTarget(item: ForwardTarget): boolean {
  if (item.kind !== 'group' && item.conversationType !== 'group') return false
  if (item.businessGroupId && dismissedGroupIds.value.has(item.businessGroupId)) return true
  if (item.conversationId && dismissedConversationKeys.value.has(item.conversationId)) return true
  return contactStore.groups.some((g) => g.status === 'dismissed' && g.name === item.name)
}

onLoad(async () => {
  if (!forwardStore.messageIds.length) {
    uni.showToast({ title: '没有可转发的消息', icon: 'none' })
    safeBack('/pages/chat/index')
    return
  }
  if (!chatStore.conversations.length) {
    await chatStore.loadConversations().catch(() => undefined)
  }
  await Promise.all([
    contactStore.reloadContacts({ keyword: '', sort: 'recent' }).catch(() => undefined),
    refreshDismissedForwardBlocklist(),
  ])
  tags.value = await fetchContactTags().catch(() => [])
})

watch(active, (tab) => {
  visibleLimit.value = PAGE_SIZE
  if (tab === 'contacts') {
    void contactStore.reloadContacts({ keyword: keyword.value, sort: 'recent' })
  }
})

watch(keyword, () => {
  visibleLimit.value = PAGE_SIZE
  if (active.value !== 'contacts') return
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void contactStore.reloadContacts({ keyword: keyword.value, sort: 'recent' })
  }, 300)
})

const selectedCount = computed(() => {
  if (allFriendsSelected.value) {
    let extra = Math.max(0, contactStore.contactTotal - excludedFriendIds.value.size)
    selected.value.forEach((item) => {
      if (item.kind !== 'contact') extra += 1
    })
    return extra
  }
  return selected.value.size
})

const listRecent = computed<ForwardTarget[]>(() =>
  chatStore.conversations
    .filter((c) => !isDissolvedGroupConversation(c))
    .map((c) => ({
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
  contactStore.groups
    .filter((g) => g.status !== 'dismissed')
    .map((g) => ({
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
  if (active.value === 'contacts') return currentRaw.value
  const k = keyword.value.trim()
  if (!k) return currentRaw.value
  return currentRaw.value.filter((i) => i.name.includes(k))
})

const currentList = computed(() => {
  if (active.value === 'contacts') return filteredList.value
  return filteredList.value.slice(0, visibleLimit.value)
})

const allSelectedInView = computed(() => {
  if (active.value === 'contacts' && !keyword.value.trim()) {
    return allFriendsSelected.value && excludedFriendIds.value.size === 0 && contactStore.contactTotal > 0
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
    if (next.size >= contactStore.contactTotal) {
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
  if (active.value === 'contacts') {
    void contactStore.loadMoreContacts()
    return
  }
  if (visibleLimit.value < filteredList.value.length) {
    visibleLimit.value += PAGE_SIZE
  }
}

function onListScroll(e: { detail?: { scrollTop?: number; scrollHeight?: number } }) {
  const top = e.detail?.scrollTop || 0
  const height = e.detail?.scrollHeight || 0
  const view = uni.getSystemInfoSync().windowHeight || 0
  if (height > 0 && height - top - view < 240) loadMore()
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

function selectedPreviewNames() {
  const names: string[] = []
  const pushName = (name: string) => {
    if (names.length < 3 && name) names.push(name)
  }
  if (allFriendsSelected.value) {
    listContacts.value.forEach((item) => {
      if (item.businessUserId && excludedFriendIds.value.has(item.businessUserId)) return
      pushName(item.name)
    })
    selected.value.forEach((item) => {
      if (item.kind !== 'contact') pushName(item.name)
    })
    return names
  }
  selected.value.forEach((item) => pushName(item.name))
  return names
}

function confirmHint() {
  const names = selectedPreviewNames().join('、')
  return `确认传送给包含「${names}」的${selectedCount.value}个聊天？`
}

function confirmSend(content: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '',
      content,
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
    })
  })
}

function afterNativeModal() {
  return new Promise<void>((resolve) => setTimeout(resolve, 120))
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

async function resolveGroupTargetIds(groupTargets: ForwardTarget[]) {
  const ids: string[] = []
  for (const target of groupTargets) {
    if (target.businessGroupId) { ids.push(target.businessGroupId); continue }
    const conversation = chatStore.conversations.find((item) => item.id === target.conversationId)
    if (!conversation?.groupId) throw new Error(`无法识别群聊「${target.name}」`)
    ids.push((await resolveIMGroupByIM(conversation.groupId)).businessGroupId)
  }
  return [...new Set(ids)]
}

async function onSend() {
  const { friendPlan, groupTargets } = collectPlan()
  const aliveGroupTargets = groupTargets.filter((item) => !isDissolvedGroupTarget(item))
  if (sending.value) return
  if (!friendPlan && !aliveGroupTargets.length) {
    if (groupTargets.length) {
      uni.showToast({ title: '所选群聊已解散', icon: 'none' })
    }
    return
  }
  if (aliveGroupTargets.length < groupTargets.length) {
    uni.showToast({ title: '已忽略已解散的群聊', icon: 'none' })
  }
  const ok = await confirmSend(confirmHint())
  if (!ok) return
  sending.value = true
  try {
    await afterNativeModal()
    const sources = buildSources()
    const targetGroupIds = await resolveGroupTargetIds(aliveGroupTargets)
    await forwardStore.submitBatch(sources, friendPlan, targetGroupIds)
    forwardStore.markSucceeded()
    forwardStore.clear()
    uni.showToast({ title: '已加入队列', icon: 'success' })
    safeBack('/pages/chat/index')
  } catch (e) {
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
    <ImNavBar title="转发给" @back="goBack">
      <template #right>
        <view class="send" :class="{ disabled: selectedCount === 0 || sending }" @click="onSend">传送</view>
      </template>
    </ImNavBar>

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
      <text class="section-title">联络人 ({{ contactStore.contactTotal }})</text>
    </view>

    <view class="select-all" @click="toggleSelectAll">
      <text>全选</text>
      <view class="check" :class="{ on: allSelectedInView }">
        <text v-if="allSelectedInView">✓</text>
      </view>
    </view>

    <scroll-view scroll-y class="list" :lower-threshold="120" @scrolltolower="loadMore" @scroll="onListScroll">
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
