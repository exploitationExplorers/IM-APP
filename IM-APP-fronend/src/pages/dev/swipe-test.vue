<script setup lang="ts">
// 临时 demo 页面（Task 6 手测用，测试后删除）：用 mock 数据验证 ImSwipeActionItem 左滑交互
import { ref } from 'vue'
import ImSwipeActionItem from '@/components/ImSwipeActionItem.vue'
import type { Conversation } from '@/types'

const conversations = ref<Conversation[]>([
  { id: 'c1', type: 'group', title: '测试群聊A', avatar: '', lastMessage: '张三：大家好', lastMessageAt: '10:20', unreadCount: 0, pinned: false },
  { id: 'c2', type: 'private', title: '李四', avatar: '', lastMessage: '今晚一起吃饭吗', lastMessageAt: '09:15', unreadCount: 2, pinned: false },
  { id: 'c3', type: 'group', title: '项目组', avatar: '', lastMessage: '王五：明天评审', lastMessageAt: '昨天', unreadCount: 5, pinned: true },
])

const activeSwipeId = ref<string | null>(null)
const log = ref<string[]>([])

function onSwipeChange(item: Conversation, open: string) {
  activeSwipeId.value = open === 'right' ? item.id : null
  log.value.unshift(`change: ${item.title} → ${open}`)
}

function sortConversations(list: Conversation[]) {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return String(b.lastMessageAt).localeCompare(String(a.lastMessageAt))
  })
}

function onTogglePin(item: Conversation) {
  activeSwipeId.value = null
  const conv = conversations.value.find((c) => c.id === item.id)
  if (!conv) return
  conv.pinned = !conv.pinned
  conversations.value = sortConversations(conversations.value)
  log.value.unshift(`pin: ${item.title} → ${conv.pinned}`)
}

function onHideConversation(item: Conversation) {
  activeSwipeId.value = null
  conversations.value = conversations.value.filter((c) => c.id !== item.id)
  log.value.unshift(`remove: ${item.title}`)
}

function closeAll() {
  activeSwipeId.value = null
}

function reset() {
  conversations.value = [
    { id: 'c1', type: 'group', title: '测试群聊A', avatar: '', lastMessage: '张三：大家好', lastMessageAt: '10:20', unreadCount: 0, pinned: false },
    { id: 'c2', type: 'private', title: '李四', avatar: '', lastMessage: '今晚一起吃饭吗', lastMessageAt: '09:15', unreadCount: 2, pinned: false },
    { id: 'c3', type: 'group', title: '项目组', avatar: '', lastMessage: '王五：明天评审', lastMessageAt: '昨天', unreadCount: 5, pinned: true },
  ]
  activeSwipeId.value = null
  log.value.unshift('reset')
}
</script>

<template>
  <view class="page" @click="closeAll">
    <view class="header">
      <text class="title">SwipeAction Demo</text>
      <view class="btn" @click.stop="reset">重置</view>
    </view>

    <scroll-view scroll-y class="list">
      <uni-swipe-action>
        <ImSwipeActionItem
          v-for="item in conversations"
          :key="item.id"
          :item="item"
          :show="activeSwipeId === item.id ? 'right' : 'none'"
          @item-click="(i) => log.unshift('item-click: ' + i.title)"
          @change="(open) => onSwipeChange(item, open)"
        >
          <template #right>
            <view class="swipe-actions">
              <view class="swipe-btn swipe-btn-pin" :class="{ active: item.pinned }" @click.stop="onTogglePin(item)">
                <text>{{ item.pinned ? '取消置顶' : '置顶' }}</text>
              </view>
              <view class="swipe-btn swipe-btn-remove" @click.stop="onHideConversation(item)">
                <text>移除</text>
              </view>
            </view>
          </template>
        </ImSwipeActionItem>
      </uni-swipe-action>
      <view v-if="!conversations.length" class="empty">无会话</view>
    </scroll-view>

    <view class="log-panel">
      <text class="log-title">交互日志（activeSwipeId={{ activeSwipeId }}）</text>
      <text v-for="(l, i) in log.slice(0, 12)" :key="i" class="log-line">{{ l }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 40rpx;
}
.title {
  font-size: 36rpx;
  font-weight: 700;
}
.btn {
  background: #0a2fc2;
  color: #fff;
  padding: 12rpx 32rpx;
  border-radius: 12rpx;
  font-size: 26rpx;
}
.list {
  flex: 1;
  min-height: 0;
}
.conv {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  border-bottom: 1rpx solid #f0f1f4;
  background: #fff;
}
.swipe-actions {
  display: flex;
  height: 100%;
}
.swipe-btn {
  width: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #212121;
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
.log-panel {
  padding: 20rpx 32rpx;
  background: #f7f8fa;
  border-top: 1rpx solid #eee;
  max-height: 40vh;
  overflow: auto;
}
.log-title {
  font-size: 24rpx;
  color: #0a2fc2;
  display: block;
  margin-bottom: 8rpx;
}
.log-line {
  display: block;
  font-size: 22rpx;
  color: #333;
  line-height: 1.6;
}
.empty {
  text-align: center;
  color: #999;
  padding: 80rpx;
}
</style>
