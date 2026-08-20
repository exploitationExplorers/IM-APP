<script lang="ts">
/** 模块级单例：同一时刻只允许一条语音在播，切到别的气泡先停掉前一条 */
let activeVoiceStopper: (() => void) | null = null
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
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
  /** 私聊已读回执：'read' 已读 / 'unread' 未读；群聊与发送中/失败不传 */
  readState?: 'read' | 'unread'
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
  retry: [message: ChatMessage]
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

/** 发送失败：点击感叹号触发重发 */
function onRetry() {
  emit('retry', props.message)
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

/** 时长格式对齐设计稿：12'' / 1'12''（微信式） */
function formatVoiceDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  if (total < 60) return `${total}''`
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, '0')}''`
}

/** 静态波形柱高：按消息 id 稳定取一组，同一条消息不随渲染跳动；中段（最高峰附近）多排 5 根高柱 */
const WAVE_PATTERNS = [
  [12, 24, 32, 20, 14, 28, 34, 34, 33, 32, 31, 30, 22, 16, 26, 18, 12],
  [20, 14, 28, 34, 33, 32, 31, 30, 29, 18, 12, 26, 30, 16, 22, 28, 14],
  [14, 22, 16, 30, 32, 33, 32, 31, 30, 29, 26, 12, 20, 32, 24, 14, 18],
]

const waveBars = computed(() => {
  const id = props.message.id || ''
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return WAVE_PATTERNS[sum % WAVE_PATTERNS.length]
})

/** 气泡宽度随时长伸缩：260rpx 起步（12 根柱的最小排布），每秒 +6rpx，封顶 440rpx */
const voiceBubbleStyle = computed(() => {
  const seconds = Math.max(1, Math.ceil(voiceMeta.value?.duration || 1))
  const width = Math.min(260 + seconds * 6, 440)
  return { width: `${width}rpx` }
})

const playing = ref(false)
/** 已播放进度：波柱按比例分成已播（高亮）/未播两段颜色 */
const playedBars = ref(0)
let stopVoiceFn: (() => void) | null = null
/** 进度轮询兜底：个别平台 onTimeUpdate 不回调，保证进度一定推进 */
let progressTimer: ReturnType<typeof setInterval> | null = null

function clearProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

/** 进度换算：total 非法（NaN/Infinity/0）时退回消息自带时长，避免永远算出 0 */
function syncPlayedProgress(current: number, totalRaw: number) {
  const fallback = voiceMeta.value?.duration || 0
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : fallback
  if (!total) return
  const ratio = Math.min(1, Math.max(0, current / total))
  playedBars.value = Math.round(ratio * waveBars.value.length)
}

function stopVoice() {
  stopVoiceFn?.()
  stopVoiceFn = null
  playing.value = false
  playedBars.value = 0
  clearProgressTimer()
}

/**
 * 点按播放：再点一次停止；切到别的语音气泡时前一条自动停。
 * 播放中波形柱变蓝并跳动，结束/出错自动复原。
 */
function playVoice() {
  const src = toPlayableMediaUrl(voiceMeta.value?.path || '')
  if (!src) return
  if (playing.value) {
    stopVoice()
    return
  }
  activeVoiceStopper?.()
  const inner = (
    uni as unknown as {
      createInnerAudioContext?: () => {
        src: string
        currentTime: number
        duration: number
        play: () => void
        stop: () => void
        destroy: () => void
        onEnded: (cb: () => void) => void
        onError: (cb: () => void) => void
        onStop: (cb: () => void) => void
        onTimeUpdate: (cb: () => void) => void
      }
    }
  ).createInnerAudioContext?.()
  if (inner) {
    inner.src = src
    const reset = () => {
      playing.value = false
      playedBars.value = 0
      clearProgressTimer()
    }
    inner.onEnded(reset)
    inner.onError(reset)
    inner.onStop(reset)
    // 注意：onTimeUpdate 回调在部分平台不带事件参数，必须读实例的 currentTime/duration
    inner.onTimeUpdate(() => syncPlayedProgress(inner.currentTime, inner.duration))
    inner.play()
    playing.value = true
    progressTimer = setInterval(() => {
      if (!playing.value) return
      syncPlayedProgress(inner.currentTime, inner.duration)
    }, 300)
    stopVoiceFn = () => {
      try {
        inner.stop()
        inner.destroy()
      } catch {
        /* 已释放 */
      }
    }
    activeVoiceStopper = stopVoice
    return
  }
  if (typeof Audio !== 'undefined') {
    const audio = new Audio(src)
    playing.value = true
    audio.addEventListener('ended', () => {
      playing.value = false
      playedBars.value = 0
    })
    audio.addEventListener('timeupdate', () => syncPlayedProgress(audio.currentTime, audio.duration))
    audio.play().catch(() => {
      playing.value = false
    })
    stopVoiceFn = () => {
      audio.pause()
      audio.currentTime = 0
    }
    activeVoiceStopper = stopVoice
  }
}

onUnmounted(() => {
  if (activeVoiceStopper === stopVoice) activeVoiceStopper = null
  stopVoice()
})

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
      <view class="bubble-line">
        <!-- 发送失败：红色感叹号显示在气泡前面，点击重发 -->
        <view v-if="mine && message.status === 'failed'" class="retry-flag" @click.stop="onRetry">
          <text class="retry-icon">!</text>
        </view>
        <view v-if="message.type === 'image'" class="bubble image-bubble" @click="previewImage" @longpress="onLongPress" @contextmenu.prevent="onContextMenu">
        <image class="msg-image" :src="message.content" mode="widthFix" />
      </view>
      <view
        v-else-if="message.type === 'voice'"
        class="bubble voice-bubble"
        :class="[mine ? 'bubble-mine voice-mine' : 'bubble-other voice-other', { playing: playing }]"
        :style="voiceBubbleStyle"
        @click="playVoice"
        @longpress="onLongPress"
        @contextmenu.prevent="onContextMenu"
      >
        <view class="voice-inner">
          <view class="voice-play-icon"></view>
          <view class="voice-wave">
            <view
              v-for="(h, i) in waveBars"
              :key="i"
              class="voice-bar"
              :class="{ played: i < playedBars }"
              :style="{ height: `${h}rpx` }"
            ></view>
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
      </view>
      <view class="meta-row">
        <!-- 私聊已读标识（微信式钩）：未读单钩 / 已读双钩，放在时间前面 -->
        <view v-if="readState" class="read-flag" :class="{ read: readState === 'read' }">
          <view class="tick first"></view>
          <view v-if="readState === 'read'" class="tick second"></view>
        </view>
        <text class="time">{{ timeText }}</text>
      </view>
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

/** 气泡行：感叹号（失败）在气泡前面，与气泡水平居中排列 */
.bubble-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
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
  max-width: 440rpx;
  box-sizing: border-box;
  padding: 18rpx 24rpx;
}

.voice-inner {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

/** 最前面的播放三角：CSS 画的 ▶，默认黑色与波形一致，播放态换暂停图标；margin 让图标和波形隔开 */
.voice-play-icon {
  flex-shrink: 0;
  margin-right: 16rpx;
  width: 0;
  height: 0;
  border-top: 10rpx solid transparent;
  border-bottom: 10rpx solid transparent;
  border-left: 16rpx solid #000;
}

/** 播放中：播放三角换成暂停图标（两根竖条） */
.voice-bubble.playing .voice-play-icon {
  width: 16rpx;
  height: 20rpx;
  border: none;
  position: relative;
}

.voice-bubble.playing .voice-play-icon::before,
.voice-bubble.playing .voice-play-icon::after {
  content: '';
  position: absolute;
  top: 0;
  width: 4rpx;
  height: 20rpx;
  border-radius: 2rpx;
  background: #000;
}

.voice-bubble.playing .voice-play-icon::before {
  left: 0;
}

.voice-bubble.playing .voice-play-icon::after {
  right: 0;
}

/** 波形紧凑排列在图标右侧，剩余空白留给时长一侧 */
.voice-wave {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.voice-bar {
  width: 2rpx;
  border-radius: 1rpx;
  background: #8a93a1;
  transition: background-color 0.2s ease;
}

/** 播放进度双色：未播灰色，已播过的柱子变黑（两侧统一配色） */
.voice-bar.played {
  background: #000;
}

.voice-duration {
  flex-shrink: 0;
  font-size: 24rpx;
  line-height: 1;
  color: #000;
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
  background: #fff;
}

.voice-mine {
  background: #bfe3ff;
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

/** 气泡下方的元信息行：已读钩 + 时间（自己一侧右对齐） */
.meta-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 8rpx;
}

/** 未读单钩浅灰；已读双钩略深一档，与微信观感一致 */
.read-flag {
  position: relative;
  width: 24rpx;
  height: 14rpx;
  flex-shrink: 0;
  color: #b3bac6;
}

.read-flag.read {
  color: #7f8896;
}

/** CSS 画的钩形（border-left + border-bottom 旋转 -45°），顶点朝下、底边贴容器底部 */
.tick {
  position: absolute;
  bottom: 1rpx;
  border-left: 3rpx solid currentColor;
  border-bottom: 3rpx solid currentColor;
  box-sizing: border-box;
  transform: rotate(-45deg);
}

.tick.first {
  left: 0;
  width: 15rpx;
  height: 8rpx;
}

/** 双钩的第二钩：起点落在第一钩的臂上，两钩交叉连贯（微信式 ✓✓） */
.tick.second {
  left: 8rpx;
  width: 12rpx;
  height: 7rpx;
}

/** 发送失败感叹号：红色圆形 + 白感叹号，点击重发 */
.retry-flag {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: #e54d42;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.retry-icon {
  color: #fff;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1;
}

.time {
  font-size: 22rpx;
  line-height: 1;
  color: #bbb;
}
</style>
