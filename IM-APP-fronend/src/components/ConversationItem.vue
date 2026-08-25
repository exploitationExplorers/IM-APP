<script setup lang="ts">
import { computed } from 'vue'
import type { Conversation } from '@/types'
import { APP_CONFIG } from '@/config'
import { formatRelativeTime } from '@/utils/format'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  item: Conversation
  /** H5 PC 三栏：当前选中会话高亮 */
  selected?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', item: Conversation): void
}>()

const chatStore = useChatStore()
const timeText = computed(() => formatRelativeTime(props.item.lastMessageAt))
/** 列表预览压成单行，避免长文/换行把会话行撑开（对齐参考站省略号） */
const previewText = computed(() =>
  String(props.item.lastMessage || '')
    .replace(/\s+/g, ' ')
    .trim(),
)
const isMuted = computed(() => props.item.recvMsgOpt === 1 || props.item.recvMsgOpt === 2)
const isOnline = computed(
  () =>
    props.item.type === 'private' &&
    !!props.item.peerUserId &&
    chatStore.isPeerOnline(props.item.peerUserId),
)
/** 会话本地最后一条消息是否发送失败：是则列表预览显示感叹号 */
const lastFailed = computed(() => {
  const list = chatStore.messagesMap[props.item.id] || []
  return list[list.length - 1]?.status === 'failed'
})
</script>

<template>
  <view class="conv" :class="{ selected }" @click="emit('click', item)">
    <view class="avatar-wrap">
      <image class="avatar" :src="item.avatar || '/static/avatar-1.png'" mode="aspectFill" />
      <image v-if="item.pinned" class="pin-badge" src="/static/icons/icon-pin.svg" mode="aspectFit" />
      <view v-if="isOnline" class="online-dot" />
    </view>
    <view class="body">
      <view class="top">
        <text class="title">{{ item.title }}</text>
        <text class="time">{{ timeText }}</text>
      </view>
      <view class="bottom">
        <view class="preview">
          <view v-if="lastFailed" class="failed-mark">!</view>
          <image v-if="isMuted" class="mute-icon" src="/static/icons/icon-bell-slash.svg" mode="aspectFit" />
          <text v-for="tag in item.highlightTags" :key="tag" class="tag">{{ tag }}</text>
          <view class="msg">{{ previewText }}</view>
        </view>
        <view v-if="item.unreadCount > 0" class="badge">
          <text class="badge-text">{{ item.unreadCount > 99 ? '99+' : item.unreadCount }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.conv {
  display: flex;
  padding: 24rpx 40rpx;
  background: #fff;
  border-bottom: 1rpx solid #f0f1f4;
}

.conv.selected {
  background: #f0f1f4;
}

.avatar-wrap {
  position: relative;
  width: 96rpx;
  height: 96rpx;
  margin-right: 24rpx;
  flex-shrink: 0;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #eee;
}

.pin-badge {
  position: absolute;
  top: -4rpx;
  right: -4rpx;
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: #297bfb;
}

.online-dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  background: #52c41a;
  border: 4rpx solid #fff;
  box-sizing: border-box;
}

.body {
  flex: 1;
  min-width: 0;
}

.top,
.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.top {
  margin-bottom: 12rpx;
}

.title {
  flex: 1;
  width: 0;
  min-width: 0;
  font-size: 32rpx;
  color: #111;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 16rpx;
}

.time {
  color: #999;
  font-size: 24rpx;
  flex-shrink: 0;
}

.preview {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
}

.tag {
  color: #e54d42;
  font-size: 26rpx;
  flex-shrink: 0;
  white-space: nowrap;
}

.mute-icon {
  width: 24rpx;
  height: 24rpx;
  margin-right: 6rpx;
  flex-shrink: 0;
}

/** 会话列表发送失败标识：红色小感叹号 */
.failed-mark {
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: #e54d42;
  color: #fff;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 6rpx;
  flex-shrink: 0;
}

.msg {
  flex: 1;
  width: 0;
  min-width: 0;
  color: #999;
  font-size: 26rpx;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  min-width: 36rpx;
  height: 36rpx;
  padding: 0 10rpx;
  background: #e54d42;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 12rpx;
}

.badge-text {
  color: #fff;
  font-size: 20rpx;
  line-height: 1;
}
</style>
