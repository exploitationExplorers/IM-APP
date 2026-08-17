<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchFavorites, type FavoriteItem } from '@/api/favorites'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { imUserId } from '@/utils/openim'
import { formatClock } from '@/utils/format'
import { getStatusBarHeight } from '@/utils/status-bar'

useAuthGuard()

/** 从我的收藏挑一条发到当前会话：文字/表情发文本，图片按 URL 直发 */
const chatStore = useChatStore()
const userStore = useUserStore()

const statusBarHeight = getStatusBarHeight()
const conversationId = ref('')
const conversationTitle = ref('')
const items = ref<FavoriteItem[]>([])
const loading = ref(false)
const sending = ref(false)

onLoad(async (query) => {
  conversationId.value = String(query?.conversationId || '')
  conversationTitle.value = decodeURIComponent(String(query?.title || ''))
  if (!conversationId.value) {
    uni.showToast({ title: '缺少会话信息', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  loading.value = true
  try {
    items.value = await fetchFavorites({ size: 50 })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '收藏加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
})

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

function isImage(item: FavoriteItem) {
  return item.type === 'image'
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

const sendable = computed(() => items.value.filter((i) => i.type === 'text' || i.type === 'emoji' || i.type === 'image'))

async function onPick(item: FavoriteItem) {
  if (sending.value || !conversationId.value) return
  if (item.type !== 'text' && item.type !== 'emoji' && item.type !== 'image') {
    uni.showToast({ title: '该类型收藏暂不支持发送', icon: 'none' })
    return
  }
  sending.value = true
  try {
    const senderId = imUserId.value || userStore.profile?.id || ''
    if (item.type === 'image') {
      await chatStore.sendImageUrl(conversationId.value, item.content, senderId)
    } else {
      await chatStore.sendText(conversationId.value, item.content, senderId)
    }
    uni.showToast({ title: '已发送', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 400)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '发送失败', icon: 'none' })
    sending.value = false
  }
}

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">我的收藏</text>
      <view class="header-pad"></view>
    </view>

    <view v-if="conversationTitle" class="target-bar">
      <text class="target-text">发送给：{{ conversationTitle }}</text>
    </view>

    <scroll-view scroll-y class="list">
      <text v-if="loading" class="loading">加载中...</text>
      <view v-for="item in items" :key="item.id" class="fav-row" @click="onPick(item)">
        <image v-if="isImage(item)" class="fav-thumb" :src="item.content" mode="aspectFill" />
        <view v-else class="fav-icon">
          <text class="fav-icon-text">{{ item.type === 'voice' ? '🎵' : item.type === 'file' ? '📁' : '💬' }}</text>
        </view>
        <view class="fav-body">
          <text class="fav-content">{{ previewText(item) }}</text>
          <text class="fav-meta">{{ typeLabel(item) }} · {{ formatClock(item.createdAt) }}</text>
        </view>
        <view class="pick-btn" :class="{ disabled: sending }">
          <text class="pick-btn-text">发送</text>
        </view>
      </view>
      <text v-if="!loading && !items.length" class="empty">暂无收藏</text>
      <text v-else-if="!loading && sendable.length === 0" class="empty">收藏均为媒体/文件，长按消息重新收藏文字或图片后可发送</text>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 32rpx;
  box-sizing: content-box;
  background: #fff;
}

.back-btn {
  font-size: 56rpx;
  color: #212121;
  width: 88rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #212121;
}

.header-pad {
  width: 88rpx;
}

.target-bar {
  padding: 8rpx 40rpx 16rpx;
}

.target-text {
  font-size: 26rpx;
  color: #8a8f9c;
}

.list {
  flex: 1;
  padding: 0 0 28rpx;
}

.fav-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 24rpx 40rpx;
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

.fav-icon-text {
  font-size: 40rpx;
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
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-meta {
  font-size: 22rpx;
  color: #8a8f9c;
}

.pick-btn {
  min-width: 104rpx;
  height: 60rpx;
  padding: 0 24rpx;
  border-radius: 999rpx;
  background: #2b5cff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pick-btn.disabled {
  opacity: 0.6;
}

.pick-btn-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #fff;
  line-height: 1;
}

.empty,
.loading {
  display: block;
  padding: 120rpx 32rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
