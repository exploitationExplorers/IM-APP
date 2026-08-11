<script setup lang="ts">
import { computed } from 'vue'
import type { Conversation } from '@/types'
import { formatRelativeTime } from '@/utils/format'

const props = defineProps<{
  item: Conversation
}>()

const emit = defineEmits<{
  (e: 'click', item: Conversation): void
}>()

const timeText = computed(() => formatRelativeTime(props.item.lastMessageAt))
</script>

<template>
  <view class="conv" @click="emit('click', item)">
    <image class="avatar" :src="item.avatar || '/static/avatar-1.png'" mode="aspectFill" />
    <view class="body">
      <view class="top">
        <text class="title">{{ item.title }}</text>
        <text class="time">{{ timeText }}</text>
      </view>
      <view class="bottom">
        <view class="preview">
          <text v-if="item.highlightTag" class="tag">{{ item.highlightTag }}</text>
          <text class="msg">{{ item.lastMessage }}</text>
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
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  margin-right: 24rpx;
  flex-shrink: 0;
  background: #eee;
}

.body {
  flex: 1;
  min-width: 0;
  border-bottom: 1rpx solid #f0f1f4;
  padding-bottom: 24rpx;
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
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag {
  color: #e54d42;
  font-size: 26rpx;
  margin-right: 6rpx;
}

.msg {
  color: #999;
  font-size: 26rpx;
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
