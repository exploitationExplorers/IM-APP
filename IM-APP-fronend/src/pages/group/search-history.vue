<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { MessageItem } from 'openim-uniapp-polyfill'
import {
  businessUserIdFromIM,
  messageSearchPreview,
  resolveGroupConversationID,
  searchLocalMessages,
} from '@/utils/openim'
import { formatFavoriteDay, formatClock } from '@/utils/format'
import ImNavBar from '@/components/ImNavBar.vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { useContactStore } from '@/stores/contact'

const contactStore = useContactStore()
const groupId = ref('')
const groupTitle = ref('')
const conversationId = ref('')
const keyword = ref('')
const loading = ref(false)
const results = ref<MessageItem[]>([])
let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** 群名可能含字面量 '%'，decodeURIComponent 会抛 URIError，这里做一次兜底 */
function safeDecode(value: string, fallback: string) {
  const raw = value || fallback
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  groupTitle.value = safeDecode(String(query?.title || ''), '群聊')
  if (!groupId.value) return
  try {
    await contactStore.ensureRemarkIndex().catch(() => undefined)
    conversationId.value = await resolveGroupConversationID(groupId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

async function runSearch(raw: string) {
  const text = raw.trim()
  const seq = ++searchSeq
  if (!text || !conversationId.value) {
    results.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const hits = await searchLocalMessages({
      keyword: text,
      conversationID: conversationId.value,
      count: 100,
    })
    if (seq !== searchSeq) return
    // 指定会话搜索时 SDK 通常只返回一项，messages 里是命中列表
    results.value = hits.flatMap((h) => h.messages)
  } catch (e) {
    if (seq !== searchSeq) return
    results.value = []
    uni.showToast({ title: (e as Error)?.message || '搜索失败', icon: 'none' })
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

watch([keyword, conversationId], () => {
  if (searchTimer) clearTimeout(searchTimer)
  const text = keyword.value.trim()
  if (!text || !conversationId.value) {
    if (!text) {
      searchSeq += 1
      results.value = []
      loading.value = false
    }
    return
  }
  searchTimer = setTimeout(() => {
    void runSearch(text)
  }, 280)
})

/** 与群聊气泡一致：好友备注优先，否则用 SDK 昵称 */
function displayNameOf(item: MessageItem) {
  const uid = businessUserIdFromIM(item.sendID || '') || item.sendID || ''
  return contactStore.remarkOf(uid) || item.senderNickname || '成员'
}

function goBack() {
  uni.navigateBack()
}

function previewOf(item: MessageItem) {
  return messageSearchPreview(item)
}

function timeOf(item: MessageItem) {
  const iso = item.sendTime ? new Date(item.sendTime).toISOString() : ''
  if (!iso) return ''
  return `${formatFavoriteDay(iso)} ${formatClock(iso)}`
}

function openResult(item: MessageItem) {
  const clientMsgId = item.clientMsgID
  if (!clientMsgId) {
    uni.showToast({ title: '无法定位该消息', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(groupId.value)}&title=${encodeURIComponent(groupTitle.value)}&clientMsgId=${encodeURIComponent(clientMsgId)}`,
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar title="搜索聊天记录" @back="goBack" />

    <AppSearchBar v-model="keyword" placeholder="请输入关键词" />

    <view v-if="keyword.trim()" class="list">
      <view v-for="item in results" :key="item.clientMsgID" class="row" @click="openResult(item)">
        <image class="avatar" :src="item.senderFaceUrl" mode="aspectFill" />
        <view class="body">
          <view class="top">
            <text class="name">{{ displayNameOf(item) }}</text>
            <text class="time">{{ timeOf(item) }}</text>
          </view>
          <text class="preview">{{ previewOf(item) }}</text>
        </view>
      </view>
      <view v-if="loading" class="empty">搜索中…</view>
      <view v-else-if="!results.length" class="empty">未找到相关记录</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.list {
  padding: 0 24rpx 40rpx;
}

.row {
  display: flex;
  gap: 20rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 12rpx;
  background: #eee;
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-width: 0;
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 8rpx;
}

.name {
  font-size: 28rpx;
  color: #212121;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 22rpx;
  color: #9aa0ad;
  flex-shrink: 0;
}

.preview {
  font-size: 26rpx;
  color: #636e86;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.empty {
  text-align: center;
  color: #9aa0ad;
  font-size: 26rpx;
  padding: 80rpx 0;
}
</style>
