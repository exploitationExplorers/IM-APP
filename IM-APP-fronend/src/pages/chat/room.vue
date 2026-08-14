<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ChatBubble from '@/components/ChatBubble.vue'
import EmojiStickerPanel from '@/components/EmojiStickerPanel.vue'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { businessUserIdFromIM, imUserId } from '@/utils/openim'
import { resolveIMGroup } from '@/api/im'
import { fetchGroupDetail } from '@/api/group'
import { APP_CONFIG } from '@/config'
import { useContactStore } from '@/stores/contact'
import type { ChatMessage } from '@/types'

const chatStore = useChatStore()
const userStore = useUserStore()
const contactStore = useContactStore()

const conversationId = ref('')
const title = ref('聊天')
const peerAvatar = ref(APP_CONFIG.defaultAvatarUrl)
const chatType = ref<'private' | 'group'>('group')
/** 业务侧的好友 / 群 ID，仅用于跳资料页 */
const businessId = ref('')
const memberCount = ref(0)
const input = ref('')
const scrollInto = ref('')
const showPlusPanel = ref(false)
const showEmojiPanel = ref(false)
const voiceMode = ref(false)
const recording = ref(false)
const recordingSeconds = ref(0)
const voiceDraft = ref<{ path: string; duration: number } | null>(null)

let recorder: any = null
let browserRecorder: { stream: MediaStream; mediaRecorder: MediaRecorder } | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null

/** 通知类（加好友等）没有可展示正文，渲染成气泡就是空气泡；撤回提示保留为居中系统行 */
function isVisibleMessage(m: ChatMessage): boolean {
  if (m.type === 'system') {
    const text = m.content.trim()
    return !!text && !text.startsWith('{') && !text.startsWith('[')
  }
  return !!m.content
}

const messages = computed(() =>
  (chatStore.messagesMap[conversationId.value] || []).filter(isVisibleMessage),
)
// 消息里的 sendID 是 OpenIM 用户 ID，不是业务用户 ID
const myId = computed(() => imUserId.value)
const myAvatar = computed(() => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl)
const settingsStore = useChatSettingsStore()

function avatarOf(message: ChatMessage): string {
  if (message.senderId === myId.value) {
    return message.senderAvatar || myAvatar.value
  }
  if (message.senderAvatar) return message.senderAvatar
  return chatType.value === 'group' ? APP_CONFIG.defaultAvatarUrl : peerAvatar.value
}

const enterToSend = computed(() => settingsStore.enterToSend)
const confirmType = computed(() => (enterToSend.value ? 'send' : 'done'))

onLoad(async (query) => {
  title.value = decodeURIComponent(String(query?.title || '聊天'))
  peerAvatar.value = decodeURIComponent(String(query?.avatar || APP_CONFIG.defaultAvatarUrl))
  chatType.value = String(query?.type || 'group') === 'private' ? 'private' : 'group'
  businessId.value = String(query?.targetId || '')
  uni.setNavigationBarTitle({ title: '' })
  uni.hideNavigationBarLoading?.()

  try {
    const conv = await chatStore.enterConversation({
      conversationId: String(query?.conversationId || ''),
      type: chatType.value,
      businessId: businessId.value,
    })
    conversationId.value = conv.id
    if (!query?.title) title.value = conv.title
    await resolveBusinessTarget(conv)
    await chatStore.loadMessages(conv.id)
    await nextTick()
    scrollToBottom()
  } catch (e) {
    console.error('[chat] 打开会话失败', e)
    uni.showToast({ title: (e as Error)?.message || '会话打开失败', icon: 'none', duration: 4000 })
  }
})

async function onScrollToUpper() {
  if (!conversationId.value) return
  const anchor = messages.value[0]?.id
  const added = await chatStore.loadMoreMessages(conversationId.value)
  if (!added || !anchor) return
  await nextTick()
  scrollInto.value = `msg_${anchor}`
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  const minute = String(Math.floor(total / 60)).padStart(2, '0')
  const second = String(total % 60).padStart(2, '0')
  return `${minute}:${second}`
}

function clearRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }
}

function cleanupBrowserRecorder() {
  if (browserRecorder) {
    browserRecorder.stream.getTracks().forEach((track) => track.stop())
    browserRecorder = null
  }
  recorder = null
}

function scrollToBottom() {
  const list = messages.value
  if (!list.length) return
  scrollInto.value = `msg_${list[list.length - 1].id}`
}

watch(
  () => messages.value[messages.value.length - 1]?.id,
  (id, prev) => {
    if (id && id !== prev) {
      nextTick(() => scrollToBottom())
    }
  },
)

async function onSend() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  showPlusPanel.value = false
  try {
    await chatStore.sendText(conversationId.value, text, myId.value)
    await nextTick()
    scrollToBottom()
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onConfirmSend() {
  if (!enterToSend.value) return
  onSend()
}

function goBack() {
  uni.navigateBack()
}

async function resolveBusinessTarget(conv: { peerUserId?: string; groupId?: string }) {
  if (chatType.value === 'private') {
    if (!businessId.value && conv.peerUserId) {
      businessId.value = businessUserIdFromIM(conv.peerUserId)
    }
    return
  }
  if (!businessId.value && conv.groupId) {
    try {
      const target = await resolveIMGroup(conv.groupId)
      businessId.value = target.businessGroupId
    } catch {
      return
    }
  }
  if (!businessId.value) return
  try {
    const detail = await fetchGroupDetail(businessId.value)
    memberCount.value = detail.memberCount || 0
    if (!title.value || title.value === '聊天') title.value = detail.name
  } catch {
    memberCount.value = 0
  }
}

function goToProfile() {
  if (!businessId.value) {
    uni.showToast({ title: '暂时无法打开资料', icon: 'none' })
    return
  }
  if (chatType.value === 'private') {
    uni.navigateTo({
      url: `/pages/contacts/friend-detail?id=${encodeURIComponent(businessId.value)}`,
    })
    return
  }
  uni.navigateTo({
    url: `/pages/group/detail?id=${encodeURIComponent(businessId.value)}`,
  })
}

function resolveSenderBusinessId(message: ChatMessage): string {
  if (chatType.value === 'private' && businessId.value) return businessId.value
  return businessUserIdFromIM(message.senderId)
}

async function onAvatarClick(message: ChatMessage) {
  if (message.senderId === myId.value) return
  const userId = resolveSenderBusinessId(message)
  if (!userId) {
    uni.showToast({ title: '无法打开资料', icon: 'none' })
    return
  }

  if (chatType.value === 'private') {
    uni.navigateTo({ url: `/pages/contacts/friend-detail?id=${encodeURIComponent(userId)}` })
    return
  }

  if (!contactStore.contacts.length) {
    try {
      await contactStore.loadDirectory()
    } catch {
      // 通讯录拉失败时按非好友打开资料页
    }
  }
  const isFriend = contactStore.contacts.some((c) => c.id === userId)
  const path = isFriend
    ? `/pages/contacts/friend-detail?id=${encodeURIComponent(userId)}`
    : `/pages/contacts/user-profile?id=${encodeURIComponent(userId)}`
  uni.navigateTo({ url: path })
}

function requestAudioPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    const authorize = (uni as any).authorize
    if (typeof authorize === 'function') {
      authorize({
        scope: 'scope.record',
        success: () => resolve(true),
        fail: () => {
          uni.showToast({ title: '需要录音权限', icon: 'none' })
          resolve(false)
        },
      })
      return
    }
    resolve(true)
  })
}

async function startVoiceRecord() {
  if (recording.value) return

  const uniRecorder = (uni as any).getRecorderManager?.()
  if (uniRecorder) {
    const ok = await requestAudioPermission()
    if (!ok) return

    recorder = uniRecorder
    voiceMode.value = true
    recording.value = true
    recordingSeconds.value = 0
    voiceDraft.value = null
    clearRecordingTimer()

    recorder.onStop = (res: { tempFilePath?: string; duration?: number }) => {
      recording.value = false
      clearRecordingTimer()
      const path = res.tempFilePath || ''
      const duration = Number(res.duration || recordingSeconds.value || 0)
      if (!path) {
        voiceMode.value = false
        return
      }
      voiceDraft.value = { path, duration }
    }

    recorder.onError = () => {
      recording.value = false
      clearRecordingTimer()
      voiceMode.value = false
      voiceDraft.value = null
      cleanupBrowserRecorder()
      uni.showToast({ title: '录音失败', icon: 'none' })
    }

    recorder.start({ format: 'mp3' })
    recordingTimer = setInterval(() => {
      recordingSeconds.value += 1
      if (recordingSeconds.value >= 60) {
        stopVoiceRecord()
      }
    }, 1000)
    return
  }

  const canUseBrowserRecorder =
    typeof window !== 'undefined' &&
    (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    (
      (!!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined') ||
      !!(navigator as any).getUserMedia ||
      !!(navigator as any).webkitGetUserMedia
    )

  if (!canUseBrowserRecorder) {
    uni.showToast({ title: 'H5 浏览器需允许麦克风权限，并在 HTTPS/localhost 环境下使用', icon: 'none' })
    return
  }

  const ok = await requestAudioPermission()
  if (!ok) return

  voiceMode.value = true
  recording.value = true
  recordingSeconds.value = 0
  voiceDraft.value = null
  clearRecordingTimer()

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream)
    const chunks: BlobPart[] = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      recording.value = false
      clearRecordingTimer()
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
      const path = URL.createObjectURL(blob)
      voiceDraft.value = { path, duration: Math.max(1, recordingSeconds.value) }
      stream.getTracks().forEach((track) => track.stop())
      browserRecorder = null
      recorder = null
    }

    mediaRecorder.onerror = () => {
      recording.value = false
      clearRecordingTimer()
      voiceMode.value = false
      voiceDraft.value = null
      stream.getTracks().forEach((track) => track.stop())
      browserRecorder = null
      recorder = null
      uni.showToast({ title: '录音失败', icon: 'none' })
    }

    browserRecorder = { stream, mediaRecorder }
    recorder = mediaRecorder
    mediaRecorder.start()
    recordingTimer = setInterval(() => {
      recordingSeconds.value += 1
      if (recordingSeconds.value >= 60) {
        stopVoiceRecord()
      }
    }, 1000)
  } catch {
    uni.showToast({ title: '当前平台不支持录音', icon: 'none' })
    voiceMode.value = false
    recording.value = false
  }
}

function stopVoiceRecord() {
  if (!recording.value) return

  if (browserRecorder && browserRecorder.mediaRecorder && browserRecorder.mediaRecorder.state !== 'inactive') {
    browserRecorder.mediaRecorder.stop()
    return
  }

  if (!recorder) return
  recorder.stop()
}

async function sendVoiceDraft() {
  if (!voiceDraft.value?.path) {
    uni.showToast({ title: '请先录音', icon: 'none' })
    return
  }

  try {
    await chatStore.sendVoice(
      conversationId.value,
      voiceDraft.value.path,
      voiceDraft.value.duration,
      myId.value,
    )
    voiceDraft.value = null
    voiceMode.value = false
    recordingSeconds.value = 0
    await nextTick()
    scrollToBottom()
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function cancelVoiceDraft() {
  voiceDraft.value = null
  voiceMode.value = false
  recordingSeconds.value = 0
  recording.value = false
  clearRecordingTimer()
  cleanupBrowserRecorder()
}

function onEmoji() {
  showEmojiPanel.value = !showEmojiPanel.value
  if (showEmojiPanel.value) {
    showPlusPanel.value = false
  }
}

function onEmojiSelect(value: string) {
  input.value += value
  showEmojiPanel.value = false
}

function onPlus() {
  showPlusPanel.value = !showPlusPanel.value
  if (showPlusPanel.value) {
    showEmojiPanel.value = false
  }
}

function pickImage() {
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      showPlusPanel.value = false
      try {
        await chatStore.sendImage(conversationId.value, res.tempFilePaths[0], myId.value)
        await nextTick()
        scrollToBottom()
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}
</script>

<template>
  <view class="room">
    <view class="chat-header">
      <view class="back-btn" @click="goBack">‹</view>
      <text v-if="chatType === 'group' && memberCount > 0" class="member-count">{{ memberCount }}</text>
      <view class="header-title" @click="goToProfile">
        <text>{{ title }}</text>
      </view>
      <view class="header-icon" @click="goToProfile">⋯</view>
    </view>

    <scroll-view
      scroll-y
      class="msg-list"
      :scroll-into-view="scrollInto"
      scroll-with-animation
      @scrolltoupper="onScrollToUpper"
    >
      <view
        v-for="m in messages"
        :id="`msg_${m.id}`"
        :key="m.id"
      >
        <view v-if="m.type === 'system'" class="sys-tip">
          <text class="sys-tip-text">{{ m.content }}</text>
        </view>
        <ChatBubble
          v-else
          :message="m"
          :mine="m.senderId === myId"
          :avatar="avatarOf(m)"
          @avatar-click="onAvatarClick(m)"
        />
      </view>
    </scroll-view>

    <view class="composer safe-bottom">
      <view v-if="voiceMode" class="voice-bar">
        <view class="voice-trash" @click="cancelVoiceDraft">🗑</view>

        <view class="voice-middle" @click="recording ? stopVoiceRecord() : undefined">
          <view class="record-dot" :class="{ active: recording }"></view>
          <text class="record-time">{{ formatDuration(recordingSeconds) }}</text>
        </view>

        <view class="voice-actions">
          <view class="send-gray-btn" @click="recording ? stopVoiceRecord() : sendVoiceDraft()">
            <text>{{ recording ? '结束' : '发送' }}</text>
          </view>
          <view class="send-icon-btn" @click="sendVoiceDraft">↑</view>
        </view>
      </view>

      <view v-else class="composer-row">
        <view class="tool" @click="startVoiceRecord">🎙</view>
        <view class="input-wrap">
          <input
            class="input"
            v-model="input"
            :confirm-type="confirmType"
            placeholder="输入消息"
            placeholder-style="color:#B0B0B0"
            @confirm="onConfirmSend"
          />
          <text class="emoji" @click="onEmoji">☺</text>
        </view>
        <view class="tool" @click="onPlus">＋</view>
      </view>

      <view v-if="showPlusPanel" class="plus-panel">
        <view class="plus-item" @click="pickImage">
          <view class="plus-icon">🖼</view>
          <text>图片</text>
        </view>
      </view>

      <EmojiStickerPanel
        v-if="showEmojiPanel"
        class="emoji-panel-shell"
        @select="onEmojiSelect"
        @close="showEmojiPanel = false"
      />
    </view>
  </view>
</template>

<style scoped lang="scss">
.room {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.chat-header {
  display: flex;
  align-items: center;
  height: 94rpx;
  padding: 0 26rpx;
  background: #ffffff;
  border-bottom: 1rpx solid #ececec;
}

.back-btn {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 52rpx;
  color: #1a1a1a;
  line-height: 1;
  flex-shrink: 0;
}

.member-count {
  margin-right: 12rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: #111;
  flex-shrink: 0;
}

.header-title {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 38rpx;
  font-weight: 700;
  color: #111;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.header-icon {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42rpx;
  color: #444;
  flex-shrink: 0;
}

.msg-list {
  flex: 1;
  height: 0;
  padding-bottom: 16rpx;
}

.sys-tip {
  display: flex;
  justify-content: center;
  padding: 12rpx 32rpx;
}

.sys-tip-text {
  font-size: 22rpx;
  color: #999;
}

.composer {
  background: #f7f7f7;
  border-top: 1rpx solid #e8e8e8;
}

.emoji-panel-shell {
  display: block;
}

.composer-row {
  display: flex;
  align-items: center;
  padding: 16rpx 20rpx;
  gap: 12rpx;
}

.tool {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  color: #333;
}

.input-wrap {
  flex: 1;
  background: #fff;
  border-radius: 36rpx;
  min-height: 72rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.input {
  flex: 1;
  font-size: 28rpx;
  height: 72rpx;
}

.emoji {
  font-size: 36rpx;
  color: #666;
  margin-left: 8rpx;
}

.voice-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 18rpx 20rpx;
  background: #f2f2f2;
}

.voice-trash {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #666;
  background: transparent;
}

.voice-middle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 76rpx;
  background: #f6f6f6;
  border-radius: 18rpx;
}

.record-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #ff4d4f;
}

.record-dot.active {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.record-time {
  font-size: 28rpx;
  color: #333;
  font-weight: 600;
}

.voice-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.send-gray-btn {
  min-width: 132rpx;
  height: 68rpx;
  border-radius: 20rpx;
  background: #d9d9d9;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  padding: 0 18rpx;
}

.send-icon-btn {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #1a73ff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 700;
}

.plus-panel {
  display: flex;
  padding: 24rpx 32rpx 32rpx;
  background: #f0f0f0;
}

.plus-item {
  width: 140rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #666;
  font-size: 24rpx;
  gap: 12rpx;
}

.plus-icon {
  width: 100rpx;
  height: 100rpx;
  background: #fff;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44rpx;
}
</style>
