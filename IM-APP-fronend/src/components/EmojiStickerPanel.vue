<script setup lang="ts">
import { ref, watch } from 'vue'
import { createSticker, fetchStickers, type StickerItem } from '@/api/sticker'
import { uploadSticker } from '@/utils/file-upload'

const emit = defineEmits<{
  (e: 'select', value: string): void
  (e: 'sticker', url: string): void
  (e: 'close'): void
}>()

type TabType = 'emoji' | 'favorite'

const activeTab = ref<TabType>('emoji')
const stickers = ref<StickerItem[]>([])
const loadingStickers = ref(false)
const uploading = ref(false)

const emojiList = [
  '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎',
  '😍', '😘', '🥰', '😗', '😙', '😚', '🙂', '🤗', '🤩', '🤔', '🤨', '😐',
  '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫', '🥱',
  '😴', '😌', '😛', '😜', '😝', '🤤', '😒', '😓', '😔', '😕', '🙃', '😲',
  '😖', '😞', '😟', '😤', '😢', '😭', '😦', '😧', '😨', '😩', '🤯', '😬',
  '😱', '🥵', '🥶', '😳', '🤪', '😵', '🤠', '🥳', '😡', '😠', '🤬', '😷',
  '👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆',
  '👇', '☝️', '👏', '🙌', '👐', '🤝', '🙏', '💪', '🫶', '❤️', '💔', '💖',
  '💗', '💘', '💝', '💞', '💓', '✨', '🌟', '🔥', '💥', '✅', '❌', '⚠️',
  '⭐', '🌈', '☀️', '🌙', '☁️', '❄️', '🎉', '🎊', '🎵', '🎶', '📌', '📎',
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮',
  '🐷', '🐵', '🐔', '🐧', '🐦', '🐤', '🦄', '🐝', '🦋', '🐌', '🐞', '🐜',
  '🍉', '🍊', '🍋', '🍌', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🥝', '🍅',
  '🍔', '🍟', '🍕', '🍜', '🍲', '🍣', '🍱', '🍡', '🍰', '🎂', '🧁', '🍪',
  '☕', '🍵', '🥤', '🍺', '🍻', '⚽', '🏀', '🎮', '🎯', '🎲'
]

async function loadStickers() {
  if (loadingStickers.value) return
  loadingStickers.value = true
  try {
    stickers.value = await fetchStickers({ page: 1, size: 100 })
  } catch {
    stickers.value = []
  } finally {
    loadingStickers.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'favorite') void loadStickers()
})

function onSelectEmoji(value: string) {
  emit('select', value)
}

function onSelectSticker(item: StickerItem) {
  if (!item.url) return
  emit('sticker', item.url)
}

function goManageEmotions() {
  emit('close')
  uni.navigateTo({ url: '/pages/mine/emotions' })
}

function onAddSticker() {
  if (uploading.value) return
  uni.chooseImage({
    count: 9,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const paths = (res.tempFilePaths || []) as string[]
      if (!paths.length) return
      uploading.value = true
      uni.showLoading({ title: '上传中...', mask: true })
      let ok = 0
      let fail = 0
      try {
        for (const path of paths) {
          try {
            const fileId = await uploadSticker(path)
            await createSticker(fileId)
            ok++
          } catch {
            fail++
          }
        }
        await loadStickers()
        if (ok && !fail) {
          uni.showToast({ title: '添加成功', icon: 'success' })
        } else if (ok && fail) {
          uni.showToast({ title: `${ok} 张成功，${fail} 张失败`, icon: 'none' })
        } else {
          uni.showToast({ title: '添加失败', icon: 'none' })
        }
      } finally {
        uni.hideLoading()
        uploading.value = false
      }
    },
  })
}

function closePanel() {
  emit('close')
}
</script>

<template>
  <view class="emoji-panel">
    <view class="tabs">
      <view class="tab" :class="{ active: activeTab === 'emoji' }" @click="activeTab = 'emoji'">
        <text class="tab-icon">☺</text>
      </view>
      <view class="tab" :class="{ active: activeTab === 'favorite' }" @click="activeTab = 'favorite'">
        <text class="tab-icon">❤</text>
      </view>
      <view class="close-btn" @click="closePanel">×</view>
    </view>

    <scroll-view scroll-y class="panel-body" show-scrollbar="false">
      <view v-if="activeTab === 'emoji'" class="emoji-grid">
        <view v-for="item in emojiList" :key="item" class="emoji-item" @click="onSelectEmoji(item)">
          <text class="emoji-char">{{ item }}</text>
        </view>
      </view>

      <view v-else class="sticker-grid">
        <view class="sticker-item add-item" @click="onAddSticker">
          <text class="add-icon">+</text>
        </view>
        <view
          v-for="item in stickers"
          :key="item.id"
          class="sticker-item"
          @click="onSelectSticker(item)"
        >
          <image class="sticker-img" :src="item.url" mode="aspectFill" />
        </view>
        <view v-if="!loadingStickers && stickers.length === 0" class="sticker-hint" @click="goManageEmotions">
          <text class="hint-text">点击 + 添加表情</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.emoji-panel {
  background: #ffffff;
  border-top: 1rpx solid #ececec;
  border-radius: 20rpx 20rpx 0 0;
  box-shadow: 0 -8rpx 24rpx rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 20rpx 12rpx;
  border-bottom: 1rpx solid #f1f1f1;
}

.tab {
  width: 52rpx;
  height: 52rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.tab.active {
  background: #f3f4f7;
}

.tab-icon {
  font-size: 34rpx;
  color: #666;
}

.close-btn {
  margin-left: auto;
  width: 42rpx;
  height: 42rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 32rpx;
}

.panel-body {
  max-height: 460rpx;
  padding: 18rpx 12rpx 12rpx;
  box-sizing: border-box;
}

.emoji-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.emoji-item {
  width: 80rpx;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14rpx;
}

.emoji-item:active {
  background: #f5f6fa;
}

.emoji-char {
  font-size: 46rpx;
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;
  padding: 4rpx 8rpx 12rpx;
}

.sticker-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12rpx;
  overflow: hidden;
  background: #f5f6f8;
}

.sticker-item:active {
  opacity: 0.85;
}

.add-item {
  box-sizing: border-box;
  border: 2rpx dashed #a0a5b3;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-icon {
  font-size: 48rpx;
  color: #a0a5b3;
  font-weight: 300;
  line-height: 1;
}

.sticker-img {
  width: 100%;
  height: 100%;
  display: block;
}

.sticker-hint {
  grid-column: 1 / -1;
  padding: 12rpx 0 4rpx;
}

.hint-text {
  font-size: 24rpx;
  color: #999;
}
</style>
