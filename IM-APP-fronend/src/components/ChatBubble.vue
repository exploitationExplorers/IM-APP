<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '@/types'
import { formatClock, splitTextWithLinks } from '@/utils/format'

const props = defineProps<{
  message: ChatMessage
  mine: boolean
  avatar: string
}>()

const parts = computed(() =>
  props.message.type === 'text' ? splitTextWithLinks(props.message.content) : [],
)

const timeText = computed(() => formatClock(props.message.createdAt))

function openLink(url: string) {
  const href = url.startsWith('http') ? url : `https://${url}`
  // #ifdef H5
  window.open(href, '_blank')
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: href,
    success: () => uni.showToast({ title: '链接已复制', icon: 'none' }),
  })
  // #endif
}
</script>

<template>
  <view class="row" :class="{ mine }">
    <image v-if="!mine" class="avatar" :src="avatar" mode="aspectFill" />
    <view class="content-wrap">
      <view v-if="message.type === 'image'" class="bubble image-bubble">
        <image class="msg-image" :src="message.content" mode="widthFix" />
      </view>
      <view v-else class="bubble" :class="mine ? 'bubble-mine' : 'bubble-other'">
        <text
          v-for="(p, idx) in parts"
          :key="idx"
          :class="p.type === 'link' ? 'link' : 'text'"
          @click="p.type === 'link' ? openLink(p.value) : undefined"
        >{{ p.value }}</text>
      </view>
      <text class="time">{{ timeText }}</text>
    </view>
    <image v-if="mine" class="avatar" :src="avatar" mode="aspectFill" />
  </view>
</template>

<style scoped lang="scss">
.row {
  display: flex;
  align-items: flex-start;
  padding: 16rpx 24rpx;
}

.row.mine {
  justify-content: flex-end;
}

.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #ddd;
  flex-shrink: 0;
}

.content-wrap {
  max-width: 70%;
  margin: 0 16rpx;
  display: flex;
  flex-direction: column;
}

.mine .content-wrap {
  align-items: flex-end;
}

.bubble {
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  font-size: 28rpx;
  line-height: 1.55;
  word-break: break-all;
  white-space: pre-wrap;
}

.bubble-other {
  background: #fff;
  color: #222;
  border-top-left-radius: 4rpx;
}

.bubble-mine {
  background: #2b5cff;
  color: #fff;
  border-top-right-radius: 4rpx;
}

.image-bubble {
  padding: 0;
  background: transparent;
  overflow: hidden;
}

.msg-image {
  width: 420rpx;
  border-radius: 12rpx;
  display: block;
}

.link {
  color: #2b5cff;
  text-decoration: underline;
}

.mine .link {
  color: #dce7ff;
}

.time {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #bbb;
}
</style>
