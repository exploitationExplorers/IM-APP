<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  deleteFavorite,
  fetchFavorites,
  FavoriteListType,
  type FavoriteItem,
} from '@/api/favorites'
import ImNavBar from '@/components/ImNavBar.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { imUserId } from '@/utils/openim'
import { formatFavoriteDay } from '@/utils/format'

useAuthGuard()

/**
 * 聊天页加号面板打开的收藏选择页：
 * 多选收藏发送到当前会话；右上角收藏图标进入管理模式可删除收藏。
 */
const chatStore = useChatStore()
const userStore = useUserStore()

const PAGE_SIZE = 20
/** 当前可直发的收藏类型：文字/表情发文本，图片按 URL 直发 */
const SENDABLE_TYPES = new Set(['text', 'emoji', 'image'])

const conversationId = ref('')
const items = ref<FavoriteItem[]>([])
const loading = ref(false)
const sending = ref(false)
const page = ref(1)
const finished = ref(false)

const TABS: Array<{ label: string; type: FavoriteListType }> = [
  { label: '全部', type: FavoriteListType.All },
  { label: '文字', type: FavoriteListType.Text },
  { label: '图片与视频', type: FavoriteListType.Media },
  { label: '文件', type: FavoriteListType.File },
  { label: '语音', type: FavoriteListType.Voice },
]

const activeTab = ref<FavoriteListType>(FavoriteListType.All)
const keyword = ref('')
const selectedIds = ref<Set<string>>(new Set())
const managing = ref(false)

onLoad(async (query) => {
  conversationId.value = String(query?.conversationId || '')
  if (!conversationId.value) {
    uni.showToast({ title: '缺少会话信息', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  await load(true)
})

async function load(reset = false) {
  if (loading.value) return
  if (reset) {
    page.value = 1
    finished.value = false
  }
  if (finished.value && !reset) return
  loading.value = true
  try {
    const next = await fetchFavorites({
      type: activeTab.value,
      page: page.value,
      size: PAGE_SIZE,
    })
    items.value = reset ? next : [...items.value, ...next]
    if (next.length < PAGE_SIZE) finished.value = true
    else page.value += 1
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '收藏加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function switchTab(type: FavoriteListType) {
  if (activeTab.value === type || loading.value) return
  activeTab.value = type
  selectedIds.value = new Set()
  void load(true)
}

const TYPE_LABELS: Record<string, string> = {
  text: '文字',
  emoji: '表情',
  image: '图片',
  video: '视频',
  file: '文件',
  voice: '语音',
}

function typeLabel(item: FavoriteItem) {
  return TYPE_LABELS[item.type] || '收藏'
}

function previewText(item: FavoriteItem) {
  const text = (item.content || '').trim()
  if (!text) return '[空收藏]'
  if (item.type === 'voice') return '[语音]'
  if (item.type === 'file' || item.type === 'video') {
    const seg = text.split(/[\\/]/).filter(Boolean).pop() || ''
    try {
      return decodeURIComponent(seg) || `[${typeLabel(item)}]`
    } catch {
      return seg || `[${typeLabel(item)}]`
    }
  }
  return text
}

/** 搜索只作用于已加载分页，按内容摘要与类型名匹配 */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return items.value
  return items.value.filter(
    (item) =>
      previewText(item).toLowerCase().includes(kw) ||
      typeLabel(item).includes(keyword.value.trim()),
  )
})

const selectedCount = computed(() => selectedIds.value.size)

function isSelected(item: FavoriteItem) {
  return selectedIds.value.has(item.id)
}

function toggle(item: FavoriteItem) {
  if (sending.value) return
  const next = new Set(selectedIds.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  selectedIds.value = next
}

function toggleManage() {
  managing.value = !managing.value
  selectedIds.value = new Set()
  uni.showToast({
    title: managing.value ? '已进入管理模式，可删除收藏' : '已退出管理模式',
    icon: 'none',
  })
}

async function sendSelected() {
  if (sending.value || managing.value || !conversationId.value) return
  const picked = filtered.value.filter(isSelected)
  if (!picked.length) return
  const unsupported = picked.filter((i) => !SENDABLE_TYPES.has(i.type))
  if (unsupported.length === picked.length) {
    uni.showToast({ title: '所选收藏暂不支持发送', icon: 'none' })
    return
  }
  sending.value = true
  try {
    const senderId = imUserId.value || userStore.profile?.id || ''
    for (const item of picked) {
      if (!SENDABLE_TYPES.has(item.type)) continue
      if (item.type === 'image') {
        await chatStore.sendImageUrl(conversationId.value, item.content, senderId)
      } else {
        await chatStore.sendText(conversationId.value, item.content, senderId)
      }
    }
    uni.showToast({
      title: unsupported.length ? `已发送，跳过 ${unsupported.length} 条不支持的类型` : '已发送',
      icon: 'none',
    })
    setTimeout(() => uni.navigateBack(), 500)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '发送失败', icon: 'none' })
    sending.value = false
  }
}

async function deleteSelected() {
  const ids = [...selectedIds.value]
  if (!ids.length || sending.value) return
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content: `确定删除这 ${ids.length} 条收藏吗？`,
      success: (res) => resolve(!!res.confirm),
    })
  })
  if (!ok) return
  sending.value = true
  try {
    for (const id of ids) await deleteFavorite(id)
    selectedIds.value = new Set()
    uni.showToast({ title: '已删除', icon: 'none' })
    await load(true)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '删除失败', icon: 'none' })
  } finally {
    sending.value = false
  }
}

function onMainAction() {
  if (managing.value) void deleteSelected()
  else void sendSelected()
}

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <ImNavBar title="我的收藏" @back="goBack">
      <template #right>
        <view class="header-btn" :class="{ on: managing }" @click="toggleManage">
          <image class="header-icon" src="/static/icon-favorite.png" mode="aspectFit" />
        </view>
      </template>
    </ImNavBar>

    <view class="search-bar">
      <view class="lens"></view>
      <input
        v-model="keyword"
        class="search-input"
        type="text"
        placeholder="搜索收藏内容"
        placeholder-class="search-placeholder"
        confirm-type="search"
      />
    </view>

    <view class="tabs">
      <view
        v-for="tab in TABS"
        :key="tab.type"
        class="tab"
        :class="{ on: activeTab === tab.type }"
        @click="switchTab(tab.type)"
      >
        {{ tab.label }}
      </view>
    </view>

    <scroll-view scroll-y class="list" @scrolltolower="load()">
      <view
        v-for="item in filtered"
        :key="item.id"
        class="fav-row"
        @click="toggle(item)"
      >
        <view class="check" :class="{ on: isSelected(item) }">
          <text v-if="isSelected(item)" class="check-mark">✓</text>
        </view>
        <image v-if="item.type === 'image'" class="fav-thumb" :src="item.content" mode="aspectFill" />
        <view v-else class="fav-icon">
          <image v-if="item.type === 'file'" class="type-img" src="/static/icon-file.png" mode="aspectFit" />
          <image v-else-if="item.type === 'voice'" class="type-img" src="/static/icon-mic.png" mode="aspectFit" />
          <image v-else-if="item.type === 'video'" class="type-img" src="/static/icon-photo.png" mode="aspectFit" />
          <text v-else class="type-glyph">文</text>
        </view>
        <view class="fav-body">
          <text class="fav-content">{{ previewText(item) }}</text>
          <text class="fav-sub">{{ typeLabel(item) }}</text>
        </view>
        <text class="fav-time">{{ formatFavoriteDay(item.createdAt) }}</text>
      </view>

      <text v-if="loading && !items.length" class="empty">加载中...</text>
      <text v-else-if="!filtered.length" class="empty">
        {{ keyword.trim() ? '无匹配收藏' : '无收藏' }}
      </text>
      <text v-else-if="loading" class="load-more">加载中...</text>
      <text v-else-if="finished" class="load-more">没有更多了</text>
    </scroll-view>

    <view class="bottom-bar">
      <view class="bar-back" @click="goBack">‹</view>
      <text class="bar-count" :class="{ zero: !selectedCount }">已选 {{ selectedCount }}</text>
      <view class="bar-space"></view>
      <view
        class="main-btn"
        :class="{ send: !managing, danger: managing, disabled: !selectedCount || sending }"
        @click="onMainAction"
      >
        <text class="main-btn-text">
          {{ managing ? `删除${selectedCount ? ` ${selectedCount}` : ''}` : sending ? '发送中...' : '发送' }}
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.header-btn {
  width: 88rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.header-btn.on {
  justify-content: center;
  background: #e8f1ff;
  border-radius: 32rpx;
}

.header-icon {
  width: 44rpx;
  height: 44rpx;
}

.search-bar {
  margin: 16rpx 32rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background: #f3f4f7;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 0 28rpx;
}

/* CSS 放大镜：圆框 + 斜把手，避免引入图标资源 */
.lens {
  width: 24rpx;
  height: 24rpx;
  border: 4rpx solid #b6bac4;
  border-radius: 50%;
  position: relative;
  flex-shrink: 0;
}

.lens::after {
  content: '';
  position: absolute;
  width: 14rpx;
  height: 4rpx;
  background: #b6bac4;
  border-radius: 2rpx;
  transform: rotate(45deg);
  right: -12rpx;
  bottom: -6rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #333;
}

:deep(.search-placeholder) {
  color: #9aa0ab;
  font-size: 28rpx;
}

.tabs {
  display: flex;
  border-bottom: 1rpx solid #eee;
}

.tab {
  flex: 1;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  font-size: 26rpx;
  color: #666;
}

.tab.on {
  color: #007aff;
  font-weight: 600;
}

.tab.on::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 48rpx;
  height: 6rpx;
  border-radius: 3rpx;
  background: #007aff;
}

.list {
  flex: 1;
  min-height: 0;
}

.fav-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 32rpx;
}

.fav-row + .fav-row {
  border-top: 1rpx solid #f5f5f5;
}

.check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid #ccc;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check.on {
  border-color: #007aff;
  background: #007aff;
}

.check-mark {
  font-size: 24rpx;
  color: #fff;
  line-height: 1;
}

.fav-thumb {
  width: 92rpx;
  height: 92rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  flex-shrink: 0;
}

.fav-icon {
  width: 92rpx;
  height: 92rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.type-img {
  width: 44rpx;
  height: 44rpx;
}

.type-glyph {
  font-size: 32rpx;
  font-weight: 600;
  color: #8a8f9c;
}

.fav-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.fav-content {
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-sub {
  font-size: 22rpx;
  color: #999;
}

.fav-time {
  font-size: 24rpx;
  color: #999;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 4rpx;
}

.empty,
.load-more {
  display: block;
  padding: 120rpx 32rpx;
  text-align: center;
  color: #999;
  font-size: 28rpx;
}

.load-more {
  padding: 32rpx;
  font-size: 24rpx;
}

.bottom-bar {
  display: flex;
  align-items: center;
  gap: 24rpx;
  height: 112rpx;
  padding: 0 32rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  box-sizing: content-box;
  background: #fff;
  border-top: 1rpx solid #eee;
}

.bar-back {
  font-size: 56rpx;
  color: #333;
  height: 56rpx;
  line-height: 56rpx;
  flex-shrink: 0;
}

.bar-count {
  font-size: 28rpx;
  font-weight: 600;
  color: #007aff;
}

.bar-count.zero {
  color: #999;
  font-weight: 400;
}

.bar-space {
  flex: 1;
}

.main-btn {
  min-width: 200rpx;
  height: 80rpx;
  padding: 0 40rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.main-btn.send {
  background: linear-gradient(135deg, #4da2ff, #007aff);
}

.main-btn.danger {
  background: #fa5151;
}

.main-btn.disabled {
  opacity: 0.5;
}

.main-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #fff;
  line-height: 1;
}
</style>
