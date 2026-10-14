<script setup lang="ts">
import { ref, computed, watch, watchEffect } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ConversationItem from '@/components/ConversationItem.vue'
import ImSwipeActionItem from '@/components/ImSwipeActionItem.vue'
import ImTabBar from '@/components/ImTabBar.vue'
import ImNotificationPermissionDialog from '@/components/ImNotificationPermissionDialog.vue'
import ImDesktopSidebar from '@/components/desktop/ImDesktopSidebar.vue'
import ImDesktopListResizer from '@/components/desktop/ImDesktopListResizer.vue'
import ChatRoom from '@/pages/chat/room.vue'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useGroupStore } from '@/stores/group'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { usePullRefresh } from '@/composables/usePullRefresh'
import { useTabBar } from '@/composables/useTabBar'
import { useDesktopLayout } from '@/composables/useDesktopLayout'
import { useDesktopListResize } from '@/composables/useDesktopListResize'
import type { Conversation } from '@/types'
import { getStatusBarHeight } from '@/utils/status-bar'
import { isDissolvedGroupConversationPreview, isGroupUnavailableError, notifyGroupUnavailable } from '@/utils/im-notification'
import { setConversationRecvOpt } from '@/utils/openim'
import { resolveIMGroupByIM } from '@/api/im'
import { searchLocalMessages } from '@/utils/openim'

useAuthGuard()
useTabBar()
const { isDesktop } = useDesktopLayout()
const { listWidth, isResizing, onResizeStart } = useDesktopListResize(isDesktop)

const statusBarHeight = getStatusBarHeight()
const chatStore = useChatStore()
const contactStore = useContactStore()
const groupStore = useGroupStore()
const keyword = ref('')
/** 关键词命中历史消息的会话 id → 预览 + 可定位消息 id */
const messageHitMeta = ref<Map<string, { preview: string; clientMsgId: string }>>(new Map())
let messageSearchSeq = 0
let messageSearchTimer: ReturnType<typeof setTimeout> | null = null
const showAddMenu = ref(false)
const showReadMenu = ref(false)
const showFilter = ref(false)
const filterKey = ref<'all' | 'unread'>('all')
const selectedConv = ref<Conversation | null>(null)
/** 桌面端打开会话时定位到搜索命中的消息 */
const selectedClientMsgId = ref('')

watch(
  () => chatStore.conversations.find((c) => c.id === selectedConv.value?.id)?.title,
  (title) => {
    if (!title || !selectedConv.value || selectedConv.value.title === title) return
    selectedConv.value = { ...selectedConv.value, title }
  },
)

const filterLabel = computed(() => (filterKey.value === 'unread' ? '未读' : '全部'))

const activeSwipeId = ref<string | null>(null)
const convMenu = ref<{ item: Conversation; x: number; y: number } | null>(null)
let convMenuOpenedAt = 0

const convMenuStyle = computed(() => {
  if (!convMenu.value) return {}
  return { left: `${convMenu.value.x}px`, top: `${convMenu.value.y}px` }
})

const convMenuMuted = computed(() => {
  const opt = convMenu.value?.item.recvMsgOpt
  return opt === 1 || opt === 2
})

function onSwipeChange(item: Conversation, open: string) {
  activeSwipeId.value = open === 'right' ? item.id : null
}

/**
 * iOS 网页里 uni-swipe 的 click 会错位：点「移除」打到「置顶」，点「置顶」打到会话行。
 * 触摸落点是准的，用 touchend 判定点击，并丢掉随后那次错位 click。
 */
let actionTouch: { x: number; y: number; at: number } | null = null
let ignoreSwipeClickUntil = 0

function touchPoint(e: Event): { x: number; y: number } | null {
  const ev = e as TouchEvent
  const t = ev.changedTouches?.[0] || ev.touches?.[0]
  if (!t) return null
  return { x: t.clientX, y: t.clientY }
}

function onActionTouchStart(e: Event) {
  const point = touchPoint(e)
  if (!point) return
  actionTouch = { ...point, at: Date.now() }
}

function runSwipeAction(item: Conversation, action: 'pin' | 'remove') {
  if (action === 'pin') void onTogglePin(item)
  else void onHideConversation(item)
}

function onActionTouchEnd(e: Event, item: Conversation, action: 'pin' | 'remove') {
  const point = touchPoint(e)
  const start = actionTouch
  actionTouch = null
  if (!point || !start) return
  const moved = Math.abs(point.x - start.x) > 40 || Math.abs(point.y - start.y) > 40
  if (moved || Date.now() - start.at > 300) return
  ignoreSwipeClickUntil = Date.now() + 500
  runSwipeAction(item, action)
}

function onActionClick(item: Conversation, action: 'pin' | 'remove') {
  if (Date.now() < ignoreSwipeClickUntil) return
  runSwipeAction(item, action)
}

async function onTogglePin(item: Conversation) {
  activeSwipeId.value = null
  try {
    await chatStore.togglePin(item.id)
  } catch (e) {
    uni.showToast({
      title: (e as Error)?.message || '置顶失败',
      icon: 'none',
    })
  }
}

async function onHideConversation(item: Conversation) {
  activeSwipeId.value = null
  // 群聊：删除会话同时退出，否则通讯录「群组」里还会挂着，客户会觉得删了还在
  if (item.type === 'group') {
    const res = await uni.showModal({
      title: '退出群聊',
      content: '退出后将不再接收此群消息，并删除本群对话。群主请先转让或解散。确定退出吗？',
      confirmText: '退出',
      cancelText: '取消',
    })
    if (!res.confirm) return
    try {
      // 会话上的 groupId 是 OpenIM ID，退群接口要业务群 ID
      const imGroupId = item.groupId || ''
      const mapped = imGroupId
        ? await resolveIMGroupByIM(imGroupId).catch(() => null)
        : null
      const businessGroupId = mapped?.businessGroupId || ''
      if (!businessGroupId) {
        await chatStore.hideConversationLocal(item.id)
        if (selectedConv.value?.id === item.id) selectedConv.value = null
        uni.showToast({ title: '已删除会话', icon: 'none' })
        return
      }
      await groupStore.leave(businessGroupId)
      await chatStore.removeExitedGroupConversation(item.id)
      if (selectedConv.value?.id === item.id) selectedConv.value = null
    } catch (e) {
      const msg = (e as Error)?.message || '删除失败'
      // 群主 leave 会被拒：只藏会话，并提示去解散/转让
      if (/无权限|群主|owner|转让|解散|Forbidden/i.test(msg)) {
        try {
          await chatStore.hideConversationLocal(item.id)
          if (selectedConv.value?.id === item.id) selectedConv.value = null
          uni.showToast({ title: '已删除会话；群主需转让或解散后才会离开群组', icon: 'none' })
        } catch (hideErr) {
          uni.showToast({ title: (hideErr as Error)?.message || msg, icon: 'none' })
        }
        return
      }
      uni.showToast({ title: msg, icon: 'none' })
    }
    return
  }
  try {
    await chatStore.hideConversationLocal(item.id)
    if (selectedConv.value?.id === item.id) {
      selectedConv.value = null
    }
  } catch (e) {
    uni.showToast({
      title: (e as Error)?.message || '移除失败',
      icon: 'none',
    })
  }
}

function onSwipeItemClick(item: Conversation) {
  if (Date.now() < ignoreSwipeClickUntil) return
  activeSwipeId.value = null
  openConversation(item)
}

function truncateSearchPreview(text: string, max = 48): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

async function runMessageSearch(raw: string) {
  const k = raw.trim()
  const seq = ++messageSearchSeq
  if (!k) {
    messageHitMeta.value = new Map()
    return
  }
  const hits = await searchLocalMessages({ keyword: k, count: 100 })
  if (seq !== messageSearchSeq) return
  const map = new Map<string, { preview: string; clientMsgId: string }>()
  for (const hit of hits) {
    if (!hit.conversationID) continue
    map.set(hit.conversationID, {
      preview: truncateSearchPreview(hit.preview),
      clientMsgId: hit.clientMsgID || '',
    })
  }
  messageHitMeta.value = map
}

watch(keyword, (value) => {
  if (messageSearchTimer) clearTimeout(messageSearchTimer)
  const k = value.trim()
  if (!k) {
    messageSearchSeq += 1
    messageHitMeta.value = new Map()
    return
  }
  // 输入法组字中会频繁触发，短防抖后再打本地库
  messageSearchTimer = setTimeout(() => {
    void runMessageSearch(k)
  }, 280)
})

const filtered = computed(() => {
  let list = chatStore.conversations
  if (filterKey.value === 'unread') {
    list = list.filter((c) => c.unreadCount > 0)
  }
  if (!keyword.value.trim()) return list
  const k = keyword.value.trim().toLowerCase()
  return list
    .filter(
      (c) =>
        c.title.toLowerCase().includes(k) ||
        c.lastMessage.toLowerCase().includes(k) ||
        messageHitMeta.value.has(c.id),
    )
    .map((c) => {
      // 标题/摘要没命中、靠历史消息命中时，用命中片段替换摘要，避免仍显示无关最后一条
      const hit = messageHitMeta.value.get(c.id)
      if (
        hit &&
        !c.title.toLowerCase().includes(k) &&
        !c.lastMessage.toLowerCase().includes(k)
      ) {
        return hit.preview ? { ...c, lastMessage: hit.preview } : c
      }
      return c
    })
})

async function reloadConversations() {
  try {
    await chatStore.loadConversations()
  } catch (e) {
    const message = (e as Error)?.message || '会话加载失败'
    if (message.includes('自定义调试基座')) {
      uni.showModal({ title: '无法连接聊天', content: message, showCancel: false })
      return
    }
    uni.showToast({ title: message, icon: 'none' })
  }
}

const { refreshing, onRefresherRefresh } = usePullRefresh(reloadConversations)

async function openConversation(item: Conversation) {
  showAddMenu.value = false
  showFilter.value = false
  const hitMsgId =
    keyword.value.trim() && messageHitMeta.value.has(item.id)
      ? messageHitMeta.value.get(item.id)?.clientMsgId || ''
      : ''
  if (isDesktop.value) {
    if (isDissolvedGroupConversation(item)) {
      notifyGroupUnavailable(true)
      return
    }
    if (item.type === 'group') {
      try {
        await chatStore.assertConversationAccessible(item)
      } catch (e) {
        const msg = (e as Error)?.message || ''
        if (isGroupUnavailableError(msg)) {
          notifyGroupUnavailable(true)
          return
        }
        uni.showToast({ title: msg || '打开群聊失败', icon: 'none' })
        return
      }
    }
    selectedClientMsgId.value = hitMsgId
    selectedConv.value = item
    return
  }
  const locate = hitMsgId
    ? `&clientMsgId=${encodeURIComponent(hitMsgId)}`
    : ''
  uni.navigateTo({
    url: `/pages/chat/room?conversationId=${encodeURIComponent(item.id)}&type=${item.type}&title=${encodeURIComponent(item.title)}&avatar=${encodeURIComponent(item.avatar)}${locate}`,
  })
}

async function onMarkAllRead() {
  showFilter.value = false
  showAddMenu.value = false
  showReadMenu.value = false
  if (!chatStore.totalUnread) {
    uni.showToast({ title: '没有未读消息', icon: 'none' })
    return
  }
  try {
    await chatStore.markAllAsRead()
    uni.showToast({ title: '已全部标为已读', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '操作失败', icon: 'none' })
  }
}

function onAdd() {
  showFilter.value = false
  showReadMenu.value = false
  showAddMenu.value = !showAddMenu.value
}

function onReadMenu() {
  showFilter.value = false
  showAddMenu.value = false
  showReadMenu.value = !showReadMenu.value
}

function go(url: string) {
  showAddMenu.value = false
  uni.navigateTo({ url })
}

function goAddGroup() {
  showAddMenu.value = false
  uni.navigateTo({ url: '/pages/contacts/add-group' })
}

function setFilter(key: 'all' | 'unread') {
  filterKey.value = key
  showFilter.value = false
}

function closeMenus() {
  showAddMenu.value = false
  showReadMenu.value = false
  showFilter.value = false
  activeSwipeId.value = null
  convMenu.value = null
}

function onListScroll() {
  if (convMenu.value) convMenu.value = null
}

function onConvMenu(payload: { item: Conversation; x: number; y: number }) {
  showAddMenu.value = false
  showFilter.value = false
  const menuW = 168
  const menuH = 196
  let x = payload.x
  let y = payload.y
  if (typeof window !== 'undefined') {
    x = Math.min(Math.max(8, x), window.innerWidth - menuW - 8)
    y = Math.min(Math.max(8, y), window.innerHeight - menuH - 8)
  }
  convMenuOpenedAt = Date.now()
  convMenu.value = { item: payload.item, x, y }
}

function takeMenuItem(): Conversation | null {
  if (Date.now() - convMenuOpenedAt < 280) return null
  const item = convMenu.value?.item || null
  convMenu.value = null
  return item
}

async function onMenuPin() {
  const item = takeMenuItem()
  if (!item) return
  await onTogglePin(item)
}

async function onMenuMute() {
  const item = takeMenuItem()
  if (!item) return
  const muted = item.recvMsgOpt === 1 || item.recvMsgOpt === 2
  const opt = muted ? 0 : 2
  try {
    await setConversationRecvOpt(item.id, opt)
    chatStore.patchConversation(item.id, { recvMsgOpt: opt })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function onMenuRead() {
  const item = takeMenuItem()
  if (!item) return
  await chatStore.markAsRead(item.id)
}

async function onMenuDelete() {
  const item = takeMenuItem()
  if (!item) return
  await onHideConversation(item)
}

function clearSelectedConv() {
  selectedConv.value = null
  selectedClientMsgId.value = ''
}

/** PC 宽屏：已解散群聊不允许进入右侧聊天区（对齐参考站「这个聊天已不存在」） */
function isDissolvedGroupConversation(conv: Conversation): boolean {
  if (conv.type !== 'group') return false
  if (isDissolvedGroupConversationPreview(conv.lastMessage)) return true
  const msgs = chatStore.messagesMap[conv.id]
  if (msgs?.length) {
    const last = msgs[msgs.length - 1]
    if (last.notificationKind === 'dissolved') return true
  }
  return false
}

function pickDesktopConversation(list: Conversation[]): Conversation | null {
  return list.find((c) => !isDissolvedGroupConversation(c)) ?? null
}

/** 消费「桌面端待打开会话」：onShow 与 watch 共用，避免已在聊天 tab 时 switchTab 不触发 onShow */
async function consumePendingDesktopChat() {
  if (!isDesktop.value) return
  const pending = contactStore.takePendingDesktopChat()
  if (!pending) return
  try {
    if (!chatStore.conversations.length) {
      await chatStore.loadConversations()
    }
    const conv = await chatStore.enterConversation({
      type: pending.type,
      businessId: pending.businessId,
    })
    const matched = chatStore.conversations.find((c) => c.id === conv.id)
    const candidate: Conversation =
      matched ||
      ({
        id: conv.id,
        type: pending.type,
        title: conv.title || pending.title,
        avatar: conv.avatar || pending.avatar,
        lastMessage: conv.lastMessage || '',
        lastMessageAt: conv.lastMessageAt || '',
        unreadCount: conv.unreadCount || 0,
        pinned: false,
      } as Conversation)
    if (isDissolvedGroupConversation(candidate)) {
      notifyGroupUnavailable(true)
      return
    }
    try {
      await chatStore.assertConversationAccessible(candidate)
    } catch (e) {
      const msg = (e as Error)?.message || ''
      if (isGroupUnavailableError(msg)) {
        notifyGroupUnavailable(true)
        return
      }
      throw e
    }
    selectedConv.value = candidate
  } catch (e) {
    const msg = (e as Error)?.message || ''
    if (isGroupUnavailableError(msg)) {
      notifyGroupUnavailable(true)
      return
    }
    uni.showToast({ title: msg || '打开会话失败', icon: 'none' })
  }
}

onShow(() => {
  void consumePendingDesktopChat()
})

watch(
  () => contactStore.pendingDesktopChat?.token,
  (token) => {
    if (!token || !isDesktop.value) return
    void consumePendingDesktopChat()
  },
)

/** PC 宽屏：默认选中第一条可用会话，跳过已解散群聊 */
watchEffect(() => {
  if (!isDesktop.value) return
  const list = filtered.value
  if (!list.length) {
    selectedConv.value = null
    return
  }
  if (
    selectedConv.value &&
    list.some((c) => c.id === selectedConv.value!.id) &&
    !isDissolvedGroupConversation(selectedConv.value)
  ) {
    return
  }
  selectedConv.value = pickDesktopConversation(list)
})
</script>

<template>
  <view
    :class="isDesktop ? 'im-desktop-workspace' : 'page'"
    @click="closeMenus"
  >
    <ImDesktopSidebar v-if="isDesktop" current="chat" />

    <view
      :class="isDesktop ? 'im-desktop-list-column page-desktop-list' : ''"
      class="list-panel"
      :style="isDesktop ? { width: `${listWidth}px` } : undefined"
    >
      <view
        class="header"
        :style="isDesktop ? undefined : { paddingTop: statusBarHeight + 'px' }"
      >
        <view class="header-row">
          <text class="title">聊天</text>
          <view class="header-actions">
          <view class="add-wrap" @click.stop="onReadMenu">
            <text class="icon-more">⋯</text>
            <view v-if="showReadMenu" class="popup-menu">
              <view class="popup-item" @click="onMarkAllRead">
                <text>全部已读</text>
              </view>
            </view>
          </view>
          <view class="add-wrap" @click.stop="onAdd">
            <image class="icon-plus" src="/static/icons/icon-plus.svg" mode="aspectFit" />
            <view v-if="showAddMenu" class="popup-menu">
              <view class="popup-item" @click="go('/pages/contacts/add-friend')">
                <image class="popup-icon" src="/static/icons/menu-add-friend.svg" mode="aspectFit" />
                <text>添加朋友</text>
              </view>
              <view class="popup-item" @click="goAddGroup">
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
      </view>

      <AppSearchBar v-model="keyword" placeholder="搜索聊天 / 关键词" />

      <view class="filter-row">
        <view
          v-if="chatStore.totalUnread > 0"
          class="mark-all"
          @click.stop="onMarkAllRead"
        >全部已读</view>
        <view class="filter-wrap" @click.stop="showFilter = !showFilter">
          <text class="filter">{{ filterLabel }}</text>
          <view class="filter-caret" />
          <view v-if="showFilter" class="popup-menu filter-menu">
            <view
              class="popup-item"
              :class="{ active: filterKey === 'all' }"
              @click="setFilter('all')"
            >全部</view>
            <view
              class="popup-item"
              :class="{ active: filterKey === 'unread' }"
              @click="setFilter('unread')"
            >未读</view>
          </view>
        </view>
      </view>

      <scroll-view
        scroll-y
        class="list"
        refresher-enabled
        refresher-default-style="black"
        :refresher-triggered="refreshing"
        @refresherrefresh="onRefresherRefresh"
        @scroll="onListScroll"
      >
        <template v-if="isDesktop">
          <ConversationItem
            v-for="item in filtered"
            :key="item.id"
            :item="item"
            context-menu
            :selected="selectedConv?.id === item.id"
            @click="openConversation"
            @menu="onConvMenu"
          />
        </template>
        <uni-swipe-action v-else>
          <ImSwipeActionItem
            v-for="item in filtered"
            :key="item.id"
            :item="item"
            :show="activeSwipeId === item.id ? 'right' : 'none'"
            @item-click="onSwipeItemClick"
            @change="(open) => onSwipeChange(item, open)"
          >
            <template #right>
              <view class="swipe-actions">
                <view
                  class="swipe-btn swipe-btn-pin"
                  :class="{ active: item.pinned }"
                  @touchstart.stop="onActionTouchStart"
                  @touchend.stop.prevent="onActionTouchEnd($event, item, 'pin')"
                  @click.stop="onActionClick(item, 'pin')"
                >
                  <text>{{ item.pinned ? '取消置顶' : '置顶' }}</text>
                </view>
                <view
                  class="swipe-btn swipe-btn-remove"
                  @touchstart.stop="onActionTouchStart"
                  @touchend.stop.prevent="onActionTouchEnd($event, item, 'remove')"
                  @click.stop="onActionClick(item, 'remove')"
                >
                  <text>移除</text>
                </view>
              </view>
            </template>
          </ImSwipeActionItem>
        </uni-swipe-action>
        <view v-if="!filtered.length" class="empty">{{ keyword.trim() ? '无匹配聊天' : '无聊天消息' }}</view>
      </scroll-view>
    </view>

    <ImDesktopListResizer
      v-if="isDesktop"
      :active="isResizing"
      @start="onResizeStart"
    />

    <view v-if="isDesktop" class="im-desktop-room-column">
      <ChatRoom
        v-if="selectedConv"
        :key="selectedConv.id + (selectedClientMsgId ? `:${selectedClientMsgId}` : '')"
        embedded
        :conversation-id="selectedConv.id"
        :type="selectedConv.type"
        :title="selectedConv.title"
        :avatar="selectedConv.avatar"
        :client-msg-id="selectedClientMsgId || undefined"
        @close="clearSelectedConv"
        @dissolved="clearSelectedConv"
      />
      <view v-else class="im-desktop-room-empty">选择一个会话开始聊天</view>
    </view>

    <ImTabBar v-if="!isDesktop" current="chat" />
    <ImNotificationPermissionDialog />

    <view
      v-if="convMenu"
      class="conv-menu"
      :style="convMenuStyle"
      @click.stop
      @contextmenu.prevent.stop
    >
      <view class="conv-menu-item" @click="onMenuPin">
        {{ convMenu.item.pinned ? '取消置顶' : '置顶' }}
      </view>
      <view class="conv-menu-item" @click="onMenuMute">
        {{ convMenuMuted ? '取消免打扰' : '免打扰' }}
      </view>
      <view class="conv-menu-item" @click="onMenuRead">已读</view>
      <view class="conv-menu-item" @click="onMenuDelete">删除</view>
    </view>
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

.list-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.add-wrap {
  position: relative;
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-more {
  font-size: 44rpx;
  font-weight: 700;
  color: #212121;
  line-height: 1;
  letter-spacing: 1rpx;
}

.icon-plus {
  width: 48rpx;
  height: 48rpx;
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

.filter-menu {
  top: 48rpx;
  min-width: 200rpx;
  right: 0;
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

.filter-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 24rpx;
  padding: 0 40rpx 8rpx;
}

.mark-all {
  margin-right: auto;
  color: #0a2fc2;
  font-size: 24rpx;
  line-height: 40rpx;
}

.filter-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.filter {
  color: #636e86;
  font-size: 24rpx;
  line-height: 40rpx;
}

.filter-caret {
  width: 0;
  height: 0;
  border-left: 8rpx solid transparent;
  border-right: 8rpx solid transparent;
  border-top: 10rpx solid #636e86;
  margin-left: 4rpx;
}

.list {
  flex: 1;
  min-height: 0;
  /* #ifdef H5 */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* #endif */
}

.empty {
  text-align: center;
  color: #212121;
  padding: 80rpx 40rpx;
  font-size: 32rpx;
}

.swipe-actions {
  display: flex;
  flex-direction: row;
}

.swipe-btn {
  width: 140rpx;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #212121;
}

:deep(.button-group--right) {
  z-index: 2;
}

.swipe-btn-pin {
  background: #f0f1f4;
}

.swipe-btn-remove {
  background: #ffe5e5;
  color: #e54d42;
}

.swipe-btn.active {
  background: #e7e8ec;
}

.conv-menu {
  position: fixed;
  z-index: 80;
  min-width: 148px;
  padding: 6px 0;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
}

.conv-menu-item {
  padding: 12px 28px;
  text-align: center;
  font-size: 15px;
  line-height: 22px;
  color: #212121;
  cursor: pointer;
}

.conv-menu-item:hover {
  background: #f5f6f8;
}
</style>
