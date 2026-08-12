<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChatSettingsStore } from '@/stores/chatSettings'

type ComposerContentType = 'text' | 'image' | 'audio' | 'file' | 'favorite'

export interface ComposerContent {
  type: ComposerContentType
  text?: string
  images?: string[]
  filePath?: string
  fileName?: string
  audioPath?: string
  audioDuration?: number
}

const props = defineProps<{
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'submit', content: ComposerContent): void
}>()

type PanelType = 'plus' | 'emoji' | null
type EmojiTab = 'emoji' | 'favorite'

const input = ref('')
const panelType = ref<PanelType>(null)
const emojiTab = ref<EmojiTab>('emoji')
const voiceMode = ref(false)
const recording = ref(false)
const settingsStore = useChatSettingsStore()

const canSend = computed(() => !!input.value.trim())
const panelVisible = computed(() => panelType.value !== null)
const enterToSend = computed(() => settingsStore.enterToSend)
const confirmType = computed(() => (enterToSend.value ? 'send' : 'done'))
const plusButtonText = computed(() => (panelType.value === 'plus' ? '×' : '＋'))

const emojis = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😃',
  '😄',
  '😅',
  '😆',
  '😉',
  '😊',
  '😋',
  '😎',
  '😍',
  '😘',
  '🥰',
  '😗',
  '😙',
  '😚',
  '🙂',
  '🤗',
  '🤩',
  '🤔',
  '🤨',
  '😐',
  '😑',
  '😶',
  '🙄',
  '😏',
  '😣',
  '😥',
  '😮',
  '🤐',
  '😯',
  '😪',
  '😫',
  '🥱',
  '😴',
  '😌',
  '😛',
  '😜',
  '😝',
  '🤤',
  '😒',
  '😓',
  '😔',
  '😕',
  '🙃',
  '🫠',
  '🫣',
  '😲',
  '☹️',
  '🙁',
  '😖',
  '😞',
  '😟',
  '😤',
  '😢',
  '😭',
  '😦',
  '😧',
  '😨',
  '😩',
  '🤯',
  '😬',
  '😰',
  '😱',
  '🥵',
  '🥶',
  '😳',
  '🤪',
  '😵',
  '😵‍💫',
  '🤠',
  '🥳',
  '😡',
  '😠',
  '🤬',
  '😷',
  '🤒',
  '🤕',
  '🤢',
  '🤮',
  '🤧',
  '😇',
  '🤡',
  '👻',
  '💀',
  '👽',
  '🤖',
  '💩',
  '😺',
  '😸',
  '😹',
  '😻',
  '😼',
  '😽',
  '🙀',
  '😿',
  '😾',
  '👍',
  '👎',
  '👌',
  '🤌',
  '🤏',
  '✌️',
  '🤞',
  '🤟',
  '🤘',
  '🤙',
  '👈',
  '👉',
  '👆',
  '👇',
  '☝️',
  '🫵',
  '👏',
  '🙌',
  '👐',
  '🤲',
  '🤝',
  '🙏',
  '💪',
  '🫶',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '🤎',
  '💔',
  '💖',
  '💗',
  '💘',
  '💝',
  '💞',
  '💓',
  '💌',
  '🎉',
  '🎊',
  '✨',
  '🌟',
  '🔥',
  '💥',
  '💯',
  '✅',
  '❌',
  '⚠️',
  '⭐',
  '🌈',
  '☀️',
  '🌙',
  '☁️',
  '☂️',
  '❄️',
  '🎁',
  '🎈',
  '🎵',
  '🎶',
  '📌',
  '📎',
  '📷',
  '📸',
  '🎥',
  '📱',
  '💻',
  '⌚',
  '🧾',
  '📄',
  '📚',
  '✏️',
  '🖊️',
  '🧠',
  '👀',
  '👂',
  '👃',
  '👋',
  '🤚',
  '🖐️',
  '✋',
  '🫱',
  '🫲',
  '🫳',
  '🫴',
  '👊',
  '✊',
  '🤛',
  '🤜',
  '🤳',
  '🫰',
  '💅',
  '👑',
  '🎩',
  '🧢',
  '👓',
  '🕶️',
  '🧥',
  '👗',
  '👔',
  '👟',
  '👠',
  '🥿',
  '🧦',
  '🐶',
  '🐱',
  '🐭',
  '🐹',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐻‍❄️',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🙈',
  '🙉',
  '🙊',
  '🐔',
  '🐧',
  '🐦',
  '🐤',
  '🦆',
  '🦅',
  '🦉',
  '🦇',
  '🐺',
  '🐗',
  '🐴',
  '🦄',
  '🐝',
  '🪲',
  '🦋',
  '🐌',
  '🐞',
  '🐜',
  '🪳',
  '🕷️',
  '🦂',
  '🐢',
  '🐍',
  '🦎',
  '🦖',
  '🦕',
  '🐙',
  '🦑',
  '🦐',
  '🦞',
  '🐠',
  '🐟',
  '🐬',
  '🐳',
  '🦈',
  '🐊',
  '🐅',
  '🐆',
  '🦓',
  '🦒',
  '🦘',
  '🦬',
  '🐘',
  '🦛',
  '🦏',
  '🐫',
  '🦙',
  '🦣',
  '🐕',
  '🐈',
  '🦮',
  '🐕‍🦺',
  '🐎',
  '🐖',
  '🐏',
  '🐑',
  '🐐',
  '🦌',
  '🐓',
  '🦃',
  '🦚',
  '🦜',
  '🦢',
  '🪿',
  '🦩',
  '🍎',
  '🍐',
  '🍊',
  '🍋',
  '🍌',
  '🍉',
  '🍇',
  '🍓',
  '🫐',
  '🍒',
  '🍑',
  '🥭',
  '🍍',
  '🥥',
  '🥝',
  '🍅',
  '🥑',
  '🥦',
  '🥬',
  '🥒',
  '🌶️',
  '🌽',
  '🥕',
  '🥔',
  '🍠',
  '🥐',
  '🍞',
  '🥖',
  '🥨',
  '🧀',
  '🥚',
  '🍳',
  '🥓',
  '🥩',
  '🍗',
  '🍖',
  '🌭',
  '🍔',
  '🍟',
  '🍕',
  '🥪',
  '🥙',
  '🫔',
  '🌮',
  '🌯',
  '🥗',
  '🍝',
  '🍜',
  '🍲',
  '🍛',
  '🍣',
  '🍱',
  '🥟',
  '🫕',
  '🍤',
  '🍙',
  '🍚',
  '🍘',
  '🍥',
  '🥮',
  '🍢',
  '🍡',
  '🍧',
  '🍨',
  '🍦',
  '🥧',
  '🍰',
  '🎂',
  '🧁',
  '🍪',
  '🍩',
  '🍫',
  '🍬',
  '🍭',
  '☕',
  '🫖',
  '🍵',
  '🥤',
  '🧋',
  '🧃',
  '🍺',
  '🍻',
  '🥂',
  '🍷',
  '🍾',
  '⚽',
  '🏀',
  '🏈',
  '⚾',
  '🎾',
  '🏐',
  '🏉',
  '🎱',
  '🏓',
  '🏸',
  '🏒',
  '⛳',
  '🥊',
  '🥋',
  '🛹',
  '🚴',
  '🏃',
  '🏊',
  '🏄',
  '🧘',
  '🛫',
  '🚗',
  '🚕',
  '🚌',
  '🚇',
  '🚄',
  '🚲',
  '⛵',
  '🚀',
  '🧸',
  '🎮',
  '🧩',
  '🎯',
  '🎲',
  '🎼',
  '🎧',
  '🎤',
  '🎸',
  '🎹',
  '🥁',
]

function closePanel() {
  panelType.value = null
}

function toggleVoiceMode() {
  voiceMode.value = !voiceMode.value
  closePanel()
}

function toggleEmojiPanel() {
  if (panelType.value === 'emoji') {
    closePanel()
    return
  }
  panelType.value = 'emoji'
  emojiTab.value = 'emoji'
}

function togglePlusPanel() {
  if (panelType.value === 'plus') {
    closePanel()
    return
  }
  panelType.value = 'plus'
}

function insertEmoji(e: string) {
  input.value += e
}

function goMyEmotions() {
  uni.navigateTo({ url: '/pages/mine/emotions' })
}

function requestConfirm(content: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content,
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
}

async function onSendText() {
  const text = input.value.trim()
  if (!text) return
  const ok = await requestConfirm('确认发送消息吗？')
  if (!ok) return
  input.value = ''
  closePanel()
  emit('submit', { type: 'text', text })
}

function onConfirmSend() {
  if (!enterToSend.value) return
  onSendText()
}

async function pickImages() {
  uni.chooseImage({
    count: 9,
    success: async (res) => {
      const raw = (res as unknown as { tempFilePaths?: string[] | string }).tempFilePaths
      const images = Array.isArray(raw) ? raw : raw ? [raw] : []
      if (!images.length) return
      closePanel()
      const ok = await requestConfirm('确认发送图片吗？')
      if (!ok) return
      emit('submit', { type: 'image', images })
    },
  })
}

async function pickFile() {
  const anyUni = uni as unknown as {
    chooseMessageFile?: (opt: unknown) => void
    chooseFile?: (opt: unknown) => void
  }

  const handler = async (files: { path: string; name?: string }[]) => {
    if (!files.length) return
    closePanel()
    const ok = await requestConfirm('确认发送文件吗？')
    if (!ok) return
    emit('submit', {
      type: 'file',
      filePath: files[0].path,
      fileName: files[0].name || '文件',
    })
  }

  if (typeof anyUni.chooseMessageFile === 'function') {
    anyUni.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res: { tempFiles?: { path: string; name?: string }[] }) => {
        handler(res.tempFiles || [])
      },
      fail: () => undefined,
    })
    return
  }

  if (typeof anyUni.chooseFile === 'function') {
    anyUni.chooseFile({
      count: 1,
      success: (res: { tempFiles?: { path: string; name?: string }[] }) => {
        handler(res.tempFiles || [])
      },
      fail: () => undefined,
    })
    return
  }

  uni.showToast({ title: '当前平台暂不支持选择文件', icon: 'none' })
}

async function pickFavorite() {
  const ok = await requestConfirm('确认发送收藏内容吗？')
  if (!ok) return
  closePanel()
  emit('submit', { type: 'favorite', text: '收藏内容（Mock）' })
}

function getRecorder() {
  const anyUni = uni as unknown as { getRecorderManager?: () => any }
  if (typeof anyUni.getRecorderManager !== 'function') return null
  return anyUni.getRecorderManager()
}

async function startRecord() {
  const recorder = getRecorder()
  if (!recorder) {
    uni.showToast({ title: '当前平台暂不支持录音', icon: 'none' })
    return
  }
  if (recording.value) return
  recording.value = true
  recorder.onStop(async (res: { tempFilePath?: string; duration?: number }) => {
    recording.value = false
    const audioPath = res.tempFilePath || ''
    if (!audioPath) return
    const ok = await requestConfirm('确认发送语音吗？')
    if (!ok) return
    emit('submit', {
      type: 'audio',
      audioPath,
      audioDuration: res.duration || 0,
    })
  })
  recorder.start({ format: 'mp3' })
}

function stopRecord() {
  const recorder = getRecorder()
  if (!recorder) return
  if (!recording.value) return
  recorder.stop()
}
</script>

<template>
  <view class="composer safe-bottom">
    <view v-if="panelVisible" class="mask" @click="closePanel"></view>
    <view class="row">
      <view class="icon-btn" @click="toggleVoiceMode">🎙</view>

      <view class="center">
        <view v-if="voiceMode" class="hold-wrap">
          <view
            class="hold-btn"
            @touchstart="startRecord"
            @touchend="stopRecord"
            @touchcancel="stopRecord"
          >
            <text v-if="recording">松开 结束</text>
            <text v-else>按住 说话</text>
          </view>
        </view>
        <view v-else class="input-wrap">
          <input
            v-model="input"
            class="input"
            :placeholder="props.placeholder || '输入消息'"
            :confirm-type="confirmType"
            placeholder-style="color:#B0B0B0"
            @confirm="onConfirmSend"
          />
          <view class="icon-btn emoji" @click.stop="toggleEmojiPanel">☺</view>
        </view>
      </view>

      <view class="icon-btn" @click.stop="togglePlusPanel">{{ plusButtonText }}</view>

      <view v-if="canSend" class="send-btn" @click="onSendText">传送</view>
    </view>

    <view v-if="panelVisible" class="panel" @click.stop>
      <scroll-view scroll-y class="panel-body" show-scrollbar="false">
        <view v-if="panelType === 'plus'" class="plus-panel">
          <view class="grid">
            <view class="grid-item" @click="pickImages">
              <view class="grid-icon">🖼</view>
              <text class="grid-text">照片</text>
            </view>
            <view class="grid-item" @click="pickFile">
              <view class="grid-icon">📄</view>
              <text class="grid-text">文件</text>
            </view>
            <view class="grid-item" @click="pickFavorite">
              <view class="grid-icon">⭐</view>
              <text class="grid-text">收藏</text>
            </view>
          </view>
        </view>

        <view v-else class="emoji-wrap">
          <view class="emoji-tabs">
            <view class="emoji-tab" :class="{ active: emojiTab === 'emoji' }" @click="emojiTab = 'emoji'">
              <text class="emoji-tab-icon">☺</text>
            </view>
            <view class="emoji-tab" :class="{ active: emojiTab === 'favorite' }" @click="emojiTab = 'favorite'">
              <text class="emoji-tab-icon">❤️</text>
            </view>
          </view>

          <view v-if="emojiTab === 'emoji'" class="emoji-panel">
            <view class="emoji-grid">
              <view v-for="e in emojis" :key="e" class="emoji-item" @click="insertEmoji(e)">
                <text class="emoji-char">{{ e }}</text>
              </view>
            </view>
          </view>

          <view v-else class="fav-panel">
            <view class="grid">
              <view class="grid-item" @click="goMyEmotions">
                <view class="grid-icon">🐯</view>
                <text class="grid-text">我的表情</text>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.composer {
  background: #f7f7f7;
  border-top: 1rpx solid #e8e8e8;
  position: relative;
  z-index: 10;
}

.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: transparent;
  z-index: 8;
}

.row {
  display: flex;
  align-items: center;
  padding: 18rpx 20rpx;
  gap: 12rpx;
  position: relative;
  z-index: 9;
}

.icon-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  color: #333;
}

.center {
  flex: 1;
}

.input-wrap {
  background: #fff;
  border-radius: 12rpx;
  min-height: 72rpx;
  display: flex;
  align-items: center;
  padding: 0 18rpx;
}

.input {
  flex: 1;
  font-size: 28rpx;
  height: 72rpx;
}

.emoji {
  width: 60rpx;
  height: 60rpx;
  font-size: 36rpx;
  color: #666;
}

.send-btn {
  height: 64rpx;
  padding: 0 24rpx;
  border-radius: 10rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hold-wrap {
  background: #fff;
  border-radius: 12rpx;
  min-height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hold-btn {
  width: 100%;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #212121;
}

.panel {
  background: #ffffff;
  padding: 18rpx 20rpx 20rpx;
  border-top: 1rpx solid #f0f1f4;
  position: relative;
  z-index: 9;
}

.panel-body {
  max-height: 620rpx;
}

.plus-panel {
  padding: 6rpx 0 10rpx;
}

.plus-panel .grid {
  flex-wrap: nowrap;
  justify-content: space-around;
}

.emoji-wrap {
  padding: 4rpx 0 10rpx;
}

.emoji-tabs {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 6rpx 0 14rpx;
}

.emoji-tab {
  width: 52rpx;
  height: 52rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.emoji-tab.active {
  background: #f3f4f7;
}

.emoji-tab-icon {
  font-size: 34rpx;
  color: #666;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
}

.grid-item {
  width: 140rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.grid-icon {
  width: 100rpx;
  height: 100rpx;
  border-radius: 20rpx;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44rpx;
}

.grid-text {
  font-size: 24rpx;
  color: #666;
}

.emoji-panel {
  padding-bottom: 20rpx;
}

.emoji-grid {
  display: flex;
  flex-wrap: wrap;
}

.emoji-item {
  width: 80rpx;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.emoji-char {
  font-size: 44rpx;
}

.fav-panel {
  padding-bottom: 20rpx;
}
</style>
