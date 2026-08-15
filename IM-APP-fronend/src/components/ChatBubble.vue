<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '@/types'
import { formatClock, splitTextWithLinks } from '@/utils/format'

const props = defineProps<{
  message: ChatMessage
  mine: boolean
  avatar: string
  nickname?: string
}>()

const showNickname = computed(() => !props.mine && !!props.nickname)

const emit = defineEmits<{
  avatarClick: []
  longpress: []
}>()

function onAvatarClick() {
  if (props.mine) return
  emit('avatarClick')
}

function onLongPress() {
  emit('longpress')
}

function onContextMenu(event: Event) {
  event.preventDefault()
  emit('longpress')
}

const parts = computed(() =>
  props.message.type === 'text' ? splitTextWithLinks(props.message.content) : [],
)

const voiceMeta = computed(() => {
  if (props.message.type !== 'voice') return null
  try {
    const parsed = JSON.parse(props.message.content) as { path?: string; duration?: number }
    return {
      path: parsed.path || '',
      duration: Number(parsed.duration || 0),
    }
  } catch {
    return { path: '', duration: 0 }
  }
})

const timeText = computed(() => formatClock(props.message.createdAt))

function formatVoiceDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  const min = String(Math.floor(total / 60)).padStart(2, '0')
  const sec = String(total % 60).padStart(2, '0')
  return `${min}:${sec}`
}

function playVoice() {
  if (!voiceMeta.value?.path) return
  const inner = (uni as any).createInnerAudioContext?.()
  if (inner) {
    inner.src = voiceMeta.value.path
    inner.play()
    return
  }
  if (typeof Audio !== 'undefined') {
    const audio = new Audio(voiceMeta.value.path)
    audio.play().catch(() => undefined)
  }
}

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
    <image
      v-if="!mine"
      class="avatar"
      :src="avatar"
      mode="aspectFill"
      @click="onAvatarClick"
    />
    <view class="content-wrap">
      <text v-if="showNickname" class="nickname">{{ nickname }}</text>
      <view v-if="message.type === 'image'" class="bubble image-bubble" @longpress="onLongPress" @contextmenu.prevent="onContextMenu">
        <image class="msg-image" :src="message.content" mode="widthFix" />
      </view>
      <view
        v-else-if="message.type === 'voice'"
        class="bubble voice-bubble"
        :class="mine ? 'bubble-mine voice-mine' : 'bubble-other voice-other'"
        @click="playVoice"
        @longpress="onLongPress"
        @contextmenu.prevent="onContextMenu"
      >
        <view class="voice-inner">
          <view class="voice-play">▶</view>
          <view class="voice-wave">
            <text>▁▂▃▄▅▆▇</text>
          </view>
          <text class="voice-duration">{{ formatVoiceDuration(voiceMeta?.duration || 0) }}</text>
        </view>
      </view>
      <view v-else class="bubble" :class="mine ? 'bubble-mine' : 'bubble-other'" @longpress="onLongPress" @contextmenu.prevent="onContextMenu">
        <view v-if="message.quote" class="quote-box" :class="mine ? 'quote-mine' : 'quote-other'">
          <text class="quote-name">{{ message.quote.senderNickname }}</text>
          <text class="quote-text">{{ message.quote.content }}</text>
        </view>
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
  width: 100%;
  box-sizing: border-box;
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

.nickname {
  margin-bottom: 8rpx;
  font-size: 22rpx;
  line-height: 32rpx;
  color: #9aa3b5;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.voice-bubble {
  min-width: 260rpx;
  padding: 12rpx 18rpx;
}

.voice-inner {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.voice-play {
  font-size: 24rpx;
  font-weight: bold;
  line-height: 1;
}

.voice-wave {
  flex: 1;
  min-width: 110rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  opacity: 0.9;
}

.voice-duration {
  font-size: 22rpx;
  min-width: 70rpx;
  text-align: right;
}

.voice-other {
  background: #d9edf9;
  color: #1f2d3d;
}

.voice-mine {
  background: #bfe3ff;
  color: #1f2d3d;
}

.link {
  color: #2b5cff;
  text-decoration: underline;
}

.mine .link {
  color: #dce7ff;
}

.quote-box {
  margin-bottom: 10rpx;
  padding: 10rpx 12rpx;
  border-radius: 10rpx;
}

.quote-other {
  background: #f3f4f7;
}

.quote-mine {
  background: rgba(255, 255, 255, 0.18);
}

.quote-name {
  display: block;
  font-size: 22rpx;
  font-weight: 700;
  margin-bottom: 4rpx;
}

.quote-text {
  display: block;
  font-size: 22rpx;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #bbb;
}
</style>
