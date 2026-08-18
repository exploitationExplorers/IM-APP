<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { APP_CONFIG } from '@/config'
import type { CardPayload, ChatMessage } from '@/types'
import { formatClock, splitTextWithLinks } from '@/utils/format'

const props = defineProps<{
  message: ChatMessage
  mine: boolean
  avatar: string
  fallbackAvatar?: string
  nickname?: string
  /** 本会话全部图片消息的地址：预览时可左右滑动切换，缺省只预览本条 */
  previewUrls?: string[]
}>()

/** 头像加载失败（死链/空对象）时切换到业务侧兜底头像，避免一直显示灰色占位 */
const avatarSrc = ref(props.avatar)

watch(
  () => props.avatar,
  (v) => {
    avatarSrc.value = v
  },
)

function onAvatarError() {
  if (props.fallbackAvatar && avatarSrc.value !== props.fallbackAvatar) {
    avatarSrc.value = props.fallbackAvatar
  }
}

const showNickname = computed(() => !props.mine && !!props.nickname)

const emit = defineEmits<{
  avatarClick: []
  longpress: []
  cardView: [card: CardPayload]
}>()

function onAvatarClick() {
  if (props.mine) return
  emit('avatarClick')
}

/** 名片消息 content 为 JSON；解析失败时兜底成空名片，不影响其它类型渲染 */
const cardMeta = computed<CardPayload | null>(() => {
  if (props.message.type !== 'card') return null
  try {
    const parsed = JSON.parse(props.message.content) as Partial<CardPayload>
    return {
      userId: parsed.userId || '',
      nickname: parsed.nickname || '',
      avatar: parsed.avatar || '',
    }
  } catch {
    return { userId: '', nickname: '', avatar: '' }
  }
})

function onViewCard() {
  if (cardMeta.value) emit('cardView', cardMeta.value)
}

function onLongPress() {
  emit('longpress')
}

/**
 * 点按图片全屏预览（uni.previewImage：H5 内置查看器 / App 原生画廊）。
 * 传入会话内全部图片时可左右滑动切换；长按菜单不受影响。
 */
function previewImage() {
  if (props.message.type !== 'image') return
  const current = toPlayableMediaUrl(props.message.content || '')
  const raw = props.previewUrls?.length ? props.previewUrls : [props.message.content]
  const urls = raw.map((url) => toPlayableMediaUrl(url || '')).filter(Boolean)
  if (!current || !urls.length) return
  uni.previewImage({ urls, current })
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

/** 文件消息 content：占位阶段是文件名，发送成功后是 URL，都取最后一段当文件名 */
const fileName = computed(() => {
  if (props.message.type !== 'file') return ''
  const raw = props.message.content || ''
  const seg = raw.split(/[\\/]/).filter(Boolean).pop() || '文件'
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
})

function copyFileUrl() {
  if (props.message.type !== 'file') return
  const url = props.message.content || ''
  if (!url.startsWith('http')) return
  uni.setClipboardData({
    data: url,
    success: () => uni.showToast({ title: '文件链接已复制', icon: 'none' }),
  })
}

const timeText = computed(() => formatClock(props.message.createdAt))

function formatVoiceDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  const min = String(Math.floor(total / 60)).padStart(2, '0')
  const sec = String(total % 60).padStart(2, '0')
  return `${min}:${sec}`
}

function playVoice() {
  const src = toPlayableMediaUrl(voiceMeta.value?.path || '')
  if (!src) return
  const inner = (uni as { createInnerAudioContext?: () => { src: string; play: () => void } }).createInnerAudioContext?.()
  if (inner) {
    inner.src = src
    inner.play()
    return
  }
  if (typeof Audio !== 'undefined') {
    const audio = new Audio(src)
    audio.play().catch(() => undefined)
  }
}

/** 归一化媒体地址：网络/blob 路径原样返回，App 本地临时路径转 file:// 绝对路径（语音播放与图片预览共用） */
function toPlayableMediaUrl(path: string): string {
  if (!path) return ''
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('blob:') ||
    path.startsWith('file://')
  ) {
    return path
  }
  try {
    const converted = plus?.io?.convertLocalFileSystemURL?.(path)
    if (converted) return converted.startsWith('file://') ? converted : `file://${converted}`
  } catch {
    /* H5 没有 plus */
  }
  return path.startsWith('/') ? `file://${path}` : path
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
      :src="avatarSrc"
      mode="aspectFill"
      @click="onAvatarClick"
      @error="onAvatarError"
    />
    <view class="content-wrap">
      <text v-if="showNickname" class="nickname">{{ nickname }}</text>
      <view v-if="message.type === 'image'" class="bubble image-bubble" @click="previewImage" @longpress="onLongPress" @contextmenu.prevent="onContextMenu">
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
      <view
        v-else-if="message.type === 'card'"
        class="bubble card-bubble"
        @click="onViewCard"
        @longpress="onLongPress"
        @contextmenu.prevent="onContextMenu"
      >
        <view class="card-head">
          <image
            class="card-avatar"
            :src="cardMeta?.avatar || APP_CONFIG.defaultAvatarUrl"
            mode="aspectFill"
          />
          <text class="card-name">{{ cardMeta?.nickname || '好友名片' }}</text>
        </view>
        <view class="card-divider"></view>
        <view class="card-foot">
          <text class="card-view">查看</text>
        </view>
      </view>
      <view
        v-else-if="message.type === 'file'"
        class="bubble file-bubble"
        :class="mine ? 'bubble-mine' : 'bubble-other'"
        @click="copyFileUrl"
        @longpress="onLongPress"
        @contextmenu.prevent="onContextMenu"
      >
        <view class="file-inner">
          <view class="file-icon">📁</view>
          <view class="file-meta">
            <text class="file-name">{{ fileName }}</text>
            <text class="file-sub">文件</text>
          </view>
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
    <image v-if="mine" class="avatar" :src="avatarSrc" mode="aspectFill" @error="onAvatarError" />
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

.file-bubble {
  min-width: 320rpx;
  max-width: 420rpx;
}

.file-inner {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.file-icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 12rpx;
  background: rgba(43, 92, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  flex-shrink: 0;
}

.file-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.file-name {
  font-size: 26rpx;
  line-height: 1.4;
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.file-sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  opacity: 0.6;
}

.card-bubble {
  width: 360rpx;
  padding: 0;
  background: #fff;
  border: 1rpx solid #e3e8f0;
  overflow: hidden;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 24rpx 20rpx;
}

.card-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  flex-shrink: 0;
}

.card-name {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2d3d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-divider {
  height: 1rpx;
  background: #eef1f6;
  margin: 0 24rpx;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 14rpx 24rpx;
}

.card-view {
  font-size: 24rpx;
  font-weight: 600;
  color: #2b5cff;
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
