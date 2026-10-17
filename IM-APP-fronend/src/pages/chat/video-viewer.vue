<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { onLoad, onReady, onUnload } from '@dcloudio/uni-app'
import { useChatStore } from '@/stores/chat'
import { useForwardStore } from '@/stores/forward'
import { saveVideoToDevice, videoPlayUrlFromContent, videoPosterUrlFromContent } from '@/utils/chatMedia'
import { formatFavoriteDay } from '@/utils/format'
import { getStatusBarHeight } from '@/utils/status-bar'
import type { ChatMessage } from '@/types'

const chatStore = useChatStore()
const forwardStore = useForwardStore()
const statusBarHeight = getStatusBarHeight()

const conversationId = ref('')
const messageId = ref('')
const inlineContent = ref('')
const senderNickname = ref('')
const createdAt = ref('')

/** 用 px 固定三段布局，避免 H5 下 rpx / flex 把图标撑满屏 */
const layout = ref({
  headerH: 88,
  playerH: 500,
  bottomH: 56,
})
/** 底部安全区单独留白，按钮落在手势条上方 */
const safeBottom = ref(0)

onLoad((query) => {
  conversationId.value = String(query?.conversationId || '')
  messageId.value = String(query?.messageId || '')
  inlineContent.value = String(query?.content || '')
  senderNickname.value = String(query?.senderNickname || '')
  createdAt.value = String(query?.createdAt || '')
})

onReady(() => {
  const sys = uni.getSystemInfoSync()
  const inset = sys.safeAreaInsets?.bottom || 0
  safeBottom.value = inset
  const headerH = statusBarHeight + 48
  const bottomH = 56 + inset
  const playerH = Math.max(280, sys.windowHeight - headerH - bottomH)
  layout.value = { headerH, playerH, bottomH }
})

const message = computed<ChatMessage | null>(() => {
  const list = chatStore.messagesMap[conversationId.value] || []
  const fromStore = list.find((m) => m.id === messageId.value)
  if (fromStore) return fromStore
  if (!inlineContent.value) return null
  return {
    id: messageId.value || 'inline-video',
    conversationId: conversationId.value,
    senderId: '',
    type: 'video',
    content: inlineContent.value,
    createdAt: createdAt.value || new Date().toISOString(),
    senderNickname: senderNickname.value || undefined,
    status: 'sent',
  }
})

const videoContent = computed(() => message.value?.content || inlineContent.value)
const videoUrl = computed(() => videoPlayUrlFromContent(videoContent.value))
const videoPoster = computed(() => videoPosterUrlFromContent(videoContent.value))

const senderLabel = computed(() => message.value?.senderNickname || senderNickname.value || '视频')

const timeLabel = computed(() => {
  const iso = message.value?.createdAt || createdAt.value
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = formatFavoriteDay(iso)
  const h = date.getHours()
  const m = String(date.getMinutes()).padStart(2, '0')
  const period = h < 12 ? '上午' : '下午'
  const hour12 = h % 12 || 12
  return `${day} ${hour12}:${m} ${period}`
})

function goBack() {
  uni.navigateBack()
}

function onForward() {
  const msg = message.value
  if (!msg) return
  forwardStore.start(conversationId.value, [msg.id])
  uni.navigateTo({ url: '/pages/chat/forward' })
}

async function onSave() {
  const content = videoContent.value
  if (!content) return
  uni.showLoading({ title: '正在保存' })
  try {
    await saveVideoToDevice(content)
    uni.hideLoading()
    uni.showToast({ title: '已保存到相册', icon: 'success' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '保存视频失败', icon: 'none' })
  }
}

async function onDelete() {
  const msg = message.value
  if (!msg) return
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content: '确定删除该消息吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
    })
  })
  if (!ok) return
  try {
    await chatStore.removeLocalMany(conversationId.value, [msg.id])
    uni.showToast({ title: '已删除', icon: 'none' })
    goBack()
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' })
  }
}

function onVideoError() {
  uni.showToast({ title: '视频无法播放', icon: 'none' })
}

// #ifdef H5
let h5VideoEl: HTMLVideoElement | null = null

function mountH5Video(url: string, poster: string) {
  const host = document.querySelector('.player-host') as HTMLElement | null
  if (!host) return
  if (!h5VideoEl) {
    h5VideoEl = document.createElement('video')
    h5VideoEl.controls = true
    h5VideoEl.playsInline = true
    h5VideoEl.setAttribute('webkit-playsinline', 'true')
    h5VideoEl.preload = 'auto'
    h5VideoEl.style.cssText =
      'width:100%;height:100%;object-fit:contain;background:#000;display:block;max-width:100%;max-height:100%;'
    host.appendChild(h5VideoEl)
  }
  h5VideoEl.poster = poster
  if (!url) {
    h5VideoEl.removeAttribute('src')
    h5VideoEl.load()
    return
  }
  if (h5VideoEl.src !== url) {
    h5VideoEl.src = url
    h5VideoEl.load()
    h5VideoEl.play().catch(() => {})
  }
}

watch(
  [videoUrl, videoPoster],
  ([url, poster]) => {
    void nextTick(() => mountH5Video(url, poster))
  },
  { immediate: true },
)

onUnload(() => {
  if (h5VideoEl) {
    h5VideoEl.pause()
    h5VideoEl.removeAttribute('src')
    h5VideoEl.remove()
    h5VideoEl = null
  }
})
// #endif
</script>

<template>
  <!--
    顶栏、视频、底栏分成三段，互不重叠。
    App 原生进度条会吃掉同一区域的点击，底栏必须留在 video 外面。
    cover-view 的文字必须紧贴标签：中间再换行或套一层，真机上点不到。
  -->
  <!-- eslint-disable vue/multiline-html-element-content-newline, vue/singleline-html-element-content-newline -->
  <view class="page">
    <!-- #ifdef H5 -->
    <view
      class="header"
      :style="{ height: `${layout.headerH}px`, paddingTop: `${statusBarHeight}px` }"
    >
      <view class="header-left">
        <view
          class="back-btn"
          @tap="goBack"
        >
          <text class="back-chevron">
            ‹
          </text>
        </view>
        <view class="header-meta">
          <text class="sender-name">
            {{ senderLabel }}
          </text>
          <text class="send-time">
            {{ timeLabel }}
          </text>
        </view>
      </view>
      <view class="header-right">
        <image
          class="header-icon"
          src="/static/icons/video-category.svg"
          mode="aspectFit"
        />
        <image
          class="header-icon"
          src="/static/icons/video-share.svg"
          mode="aspectFit"
        />
      </view>
    </view>
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <!-- 占位，避免 video 顶到状态栏；真正可点的顶栏用 cover-view -->
    <view
      class="header"
      :style="{ height: `${layout.headerH}px` }"
    />
    <cover-view
      class="cover-header"
      :style="{ height: `${layout.headerH}px`, paddingTop: `${statusBarHeight}px` }"
    >
      <cover-view
        class="cover-back"
        @tap="goBack"
      >‹</cover-view>
      <cover-view class="cover-meta">
        <cover-view class="cover-sender">{{ senderLabel }}</cover-view>
        <cover-view class="cover-time">{{ timeLabel }}</cover-view>
      </cover-view>
    </cover-view>
    <!-- #endif -->

    <view
      class="player-host"
      :style="{ height: `${layout.playerH}px` }"
    >
      <!-- #ifndef H5 -->
      <video
        v-if="videoUrl"
        class="app-player"
        :style="{ width: '100%', height: `${layout.playerH}px` }"
        :src="videoUrl"
        :poster="videoPoster"
        autoplay
        controls
        object-fit="contain"
        codec="hardware"
        :http-cache="true"
        :play-strategy="0"
        :show-center-play-btn="true"
        :show-fullscreen-btn="false"
        :enable-progress-gesture="true"
        :vslide-gesture-in-fullscreen="false"
        @error="onVideoError"
      />
      <!-- #endif -->
      <view
        v-if="!videoUrl"
        class="empty-tip"
      >
        视频地址无效
      </view>
    </view>

    <!-- #ifdef H5 -->
    <view
      class="bottom-bar"
      :style="{ height: `${layout.bottomH}px`, paddingBottom: `${safeBottom}px` }"
    >
      <view
        class="tool-btn"
        @tap="onDelete"
      >
        <image
          class="tool-icon"
          src="/static/icons/video-trash.svg"
          mode="aspectFit"
        />
      </view>
      <view
        class="tool-btn"
        @tap="onSave"
      >
        <image
          class="tool-icon"
          src="/static/icons/video-download.svg"
          mode="aspectFit"
        />
      </view>
      <view
        class="tool-btn"
        @tap="onForward"
      >
        <image
          class="tool-icon tool-icon-forward"
          src="/static/icons/video-forward.svg"
          mode="aspectFit"
        />
      </view>
    </view>
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <!-- 占位把 video 顶上去；按钮用单层 cover-view，文字中间不能再套一层，否则点不到 -->
    <view
      class="bottom-bar"
      :style="{ height: `${layout.bottomH}px` }"
    />
    <cover-view
      class="cover-bottom"
      :style="{ height: `${layout.bottomH}px`, paddingBottom: `${safeBottom}px` }"
    >
      <cover-view
        class="cover-tool"
        @tap="onDelete"
      >删除</cover-view>
      <cover-view
        class="cover-tool"
        @tap="onSave"
      >保存</cover-view>
      <cover-view
        class="cover-tool"
        @tap="onForward"
      >转发</cover-view>
    </cover-view>
    <!-- #endif -->
  </view>
</template>

<style scoped lang="scss">
.page {
  position: relative;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #000;
  display: flex;
  flex-direction: column;
}

.header {
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 8px 4px;
}

.header-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.back-chevron {
  color: #fff;
  font-size: 28px;
  line-height: 1;
  font-weight: 300;
}

.header-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-right: 8px;
}

.sender-name {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-time {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 1.2;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.header-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.player-host {
  flex-shrink: 0;
  width: 100%;
  background: #000;
  overflow: hidden;
  position: relative;
}

.empty-tip {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
}

.bottom-bar {
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  padding: 0 12px;
  background: #000;
}

.tool-btn {
  flex: 1;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.tool-icon-forward {
  width: 26px;
  height: 26px;
}

.app-player { width: 100%; display: block; background: #000; }

.cover-header {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  z-index: 2;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: 4px;
  padding-right: 12px;
  background-color: rgba(0, 0, 0, 0.35);
}

.cover-back {
  width: 36px;
  height: 36px;
  color: #ffffff;
  font-size: 28px;
  line-height: 36px;
  text-align: center;
}

.cover-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.cover-sender {
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  line-height: 20px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cover-time {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 16px;
  margin-top: 2px;
}

.cover-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  background-color: #000000;
}

.cover-tool {
  width: 33%;
  height: 48px;
  color: #ffffff;
  font-size: 15px;
  line-height: 48px;
  text-align: center;
}
</style>
