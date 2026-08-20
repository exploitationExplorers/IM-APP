<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { MessageType } from 'openim-uniapp-polyfill'
import type { MessageItem } from 'openim-uniapp-polyfill'
import { collectHistoryMessages, resolveGroupConversationID } from '@/utils/openim'
import { formatFavoriteDay, formatClock } from '@/utils/format'
import ImNavBar from '@/components/ImNavBar.vue'

const groupId = ref('')
const keyword = ref('')
const loading = ref(false)
const messages = ref<MessageItem[]>([])

const results = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return []
  return messages.value.filter((item) => {
    const isText =
      item.contentType === MessageType.TextMessage ||
      item.contentType === MessageType.AtTextMessage ||
      item.contentType === MessageType.QuoteMessage
    if (!isText) return false
    return previewOf(item).toLowerCase().includes(text)
  })
})

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) return
  loading.value = true
  try {
    const conversationId = await resolveGroupConversationID(groupId.value)
    messages.value = await collectHistoryMessages(conversationId)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

function previewOf(item: MessageItem) {
  return (
    item.textElem?.content ||
    item.atTextElem?.text ||
    item.quoteElem?.text ||
    ''
  )
}

function timeOf(item: MessageItem) {
  const iso = item.sendTime ? new Date(item.sendTime).toISOString() : ''
  if (!iso) return ''
  return `${formatFavoriteDay(iso)} ${formatClock(iso)}`
}

function openRoom() {
  uni.navigateTo({
    url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(groupId.value)}`,
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar title="搜索聊天记录" @back="goBack" />

    <view class="search-wrap">
      <view class="search-box">
        <input
          class="search-input"
          v-model="keyword"
          placeholder="请输入关键词"
          confirm-type="search"
        />
      </view>
    </view>

    <view v-if="keyword.trim()" class="list">
      <view v-for="item in results" :key="item.clientMsgID" class="row" @click="openRoom">
        <image class="avatar" :src="item.senderFaceUrl" mode="aspectFill" />
        <view class="body">
          <view class="top">
            <text class="name">{{ item.senderNickname || '成员' }}</text>
            <text class="time">{{ timeOf(item) }}</text>
          </view>
          <text class="preview">{{ previewOf(item) }}</text>
        </view>
      </view>
      <view v-if="!loading && !results.length" class="empty">未找到相关记录</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.search-wrap {
  padding: 8rpx 24rpx 16rpx;
}

.search-box {
  height: 72rpx;
  border-radius: 8rpx;
  background: #f3f4f7;
  padding: 0 24rpx;
}

.search-input {
  height: 72rpx;
  font-size: 28rpx;
}

.row {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #eee;
}

.body {
  flex: 1;
  min-width: 0;
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
}

.name {
  font-size: 28rpx;
  color: #1d1d1d;
}

.time {
  font-size: 22rpx;
  color: #8a8f9c;
}

.preview {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
