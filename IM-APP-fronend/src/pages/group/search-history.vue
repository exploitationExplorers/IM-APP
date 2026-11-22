<script setup lang="ts">
import { ref, watch } from 'vue'
import { onLoad, onReachBottom, onUnload } from '@dcloudio/uni-app'
import { IMEvents, type MessageItem } from 'openim-uniapp-polyfill'
import {
  businessUserIdFromIM,
  ensureLocalConversationHistory,
  messageSearchPreview,
  onIMEvent,
  resolveGroupConversationID,
  searchConversationMessagesPage,
  type ConversationMessageSearchCursor,
} from '@/utils/openim'
import { formatFavoriteDay, formatClock } from '@/utils/format'
import ImNavBar from '@/components/ImNavBar.vue'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { useContactStore } from '@/stores/contact'
import { groupRetention } from '@/utils/groupRetention'

const contactStore = useContactStore()
const groupId = ref('')
const groupTitle = ref('')
const conversationId = ref('')
const keyword = ref('')
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const searchError = ref('')
const results = ref<MessageItem[]>([])
let searchCursor: ConversationMessageSearchCursor | null = null
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
    // 对标微信：进搜索页先把该群历史落到本地（后台），输入时先出最近命中
    void ensureLocalConversationHistory(conversationId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

async function runSearch(raw: string, preserveResults = false) {
  const text = raw.trim()
  const seq = ++searchSeq
  searchError.value = ''
  searchCursor = null
  hasMore.value = false
  if (!text || !conversationId.value) {
    results.value = []
    loading.value = false
    loadingMore.value = false
    return
  }
  loading.value = true
  loadingMore.value = false
  try {
    const page = await searchConversationMessagesPage({
      conversationID: conversationId.value,
      keyword: text,
      continueOnEmpty: true,
      isCancelled: () => seq !== searchSeq,
    })
    if (seq !== searchSeq) return
    if (preserveResults) mergeResults(page.messages)
    else results.value = page.messages
    searchCursor = page.cursor
    if (preserveResults) {
      const displayed = new Set(results.value.map((item) => item.clientMsgID))
      searchCursor.pending = searchCursor.pending.filter((item) => !displayed.has(item.clientMsgID))
      searchCursor.seenIds = [...new Set([...searchCursor.seenIds, ...displayed])]
    }
    hasMore.value = page.hasMore
  } catch (e) {
    if (seq !== searchSeq) return
    if (!preserveResults) results.value = []
    searchCursor = null
    hasMore.value = false
    searchError.value = (e as Error)?.message || '搜索失败，请重试'
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

function mergeResults(messages: MessageItem[]) {
  const merged = new Map(results.value.map((item) => [item.clientMsgID, item]))
  for (const item of messages) {
    if (item.clientMsgID) merged.set(item.clientMsgID, item)
  }
  results.value = groupRetention.filter(conversationId.value, [...merged.values()])
    .sort((a, b) => Number(b.sendTime || 0) - Number(a.sendTime || 0))
}

/** 上滑加载更早的命中：继续翻本地索引 / 历史，不重头搜 */
async function loadMore() {
  const text = keyword.value.trim()
  if (
    !text ||
    !conversationId.value ||
    !searchCursor ||
    !hasMore.value ||
    loading.value ||
    loadingMore.value
  ) {
    return
  }
  const seq = searchSeq
  searchError.value = ''
  loadingMore.value = true
  try {
    const page = await searchConversationMessagesPage({
      conversationID: conversationId.value,
      keyword: text,
      cursor: searchCursor,
      continueOnEmpty: true,
      isCancelled: () => seq !== searchSeq,
    })
    if (seq !== searchSeq) return
    mergeResults(page.messages)
    searchCursor = page.cursor
    hasMore.value = page.hasMore
  } catch (e) {
    if (seq !== searchSeq) return
    searchError.value = (e as Error)?.message || '加载更多失败，请重试'
  } finally {
    if (seq === searchSeq) loadingMore.value = false
  }
}

onReachBottom(() => {
  void loadMore()
})

watch([keyword, conversationId], () => {
  // 换词时立即作废旧查询，不能等防抖结束才拦截旧结果。
  searchSeq += 1
  searchError.value = ''
  if (searchTimer) clearTimeout(searchTimer)
  const text = keyword.value.trim()
  results.value = []
  searchCursor = null
  hasMore.value = false
  if (!text) {
    loading.value = false
    loadingMore.value = false
    return
  }
  loading.value = true
  loadingMore.value = false
  // 会话 ID 还在 resolve 时先显示「搜索中」，避免误报「未找到」；ID 就绪后 watch 会再跑
  if (!conversationId.value) {
    return
  }
  searchTimer = setTimeout(() => {
    void runSearch(text)
  }, 280)
})

// App 离线消息同步完成后重查当前关键词，无需用户退出、刷新再搜。
const offSync = onIMEvent(IMEvents.OnSyncServerFinish, () => {
  if (!keyword.value.trim() || !conversationId.value) return
  if (searchTimer) clearTimeout(searchTimer)
  void runSearch(keyword.value, true)
})

onUnload(() => {
  searchSeq += 1
  if (searchTimer) clearTimeout(searchTimer)
  offSync()
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
    <ImNavBar
      title="搜索聊天记录"
      @back="goBack"
    />

    <AppSearchBar
      v-model="keyword"
      placeholder="请输入关键词"
    />

    <view
      v-if="keyword.trim()"
      class="list"
    >
      <view
        v-for="item in results"
        :key="item.clientMsgID"
        class="row"
        @click="openResult(item)"
      >
        <image
          class="avatar"
          :src="item.senderFaceUrl"
          mode="aspectFill"
        />
        <view class="body">
          <view class="top">
            <text class="name">
              {{ displayNameOf(item) }}
            </text>
            <text class="time">
              {{ timeOf(item) }}
            </text>
          </view>
          <text class="preview">
            {{ previewOf(item) }}
          </text>
        </view>
      </view>
      <view
        v-if="loading"
        class="empty"
      >
        搜索中…
      </view>
      <view
        v-else-if="searchError"
        class="empty"
        @click="results.length && searchCursor ? loadMore() : runSearch(keyword)"
      >
        {{ searchError }}，点击重试
      </view>
      <view
        v-else-if="!results.length && !hasMore"
        class="empty"
      >
        未找到相关记录
      </view>
      <view
        v-else-if="loadingMore"
        class="footer"
      >
        加载更多…
      </view>
      <view
        v-else-if="hasMore"
        class="footer"
        @click="loadMore"
      >
        上拉加载更多
      </view>
      <view
        v-else
        class="footer"
      >
        没有更多了
      </view>
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
  border-radius: 50%;
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

.footer {
  text-align: center;
  color: #9aa0ad;
  font-size: 24rpx;
  padding: 28rpx 0 12rpx;
}
</style>
