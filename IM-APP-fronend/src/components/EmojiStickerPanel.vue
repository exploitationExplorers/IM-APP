<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{
  (e: 'select', value: string): void
  (e: 'close'): void
}>()

type TabType = 'emoji' | 'favorite'

const activeTab = ref<TabType>('emoji')

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

const favoriteList = ['❤️', '👍', '👏', '✨', '🔥', '🎉', '😄', '😊', '🥳', '🤩', '😢', '😭']

const currentList = computed(() => (activeTab.value === 'emoji' ? emojiList : favoriteList))

function onSelect(value: string) {
  emit('select', value)
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
      <view class="emoji-grid">
        <view v-for="item in currentList" :key="item" class="emoji-item" @click="onSelect(item)">
          <text class="emoji-char">{{ item }}</text>
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
</style>
