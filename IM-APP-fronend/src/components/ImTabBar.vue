<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'

const props = defineProps<{
  current: 'contacts' | 'chat' | 'mine'
}>()

const chatStore = useChatStore()
const contactStore = useContactStore()
const { totalUnread } = storeToRefs(chatStore)
const { pendingFriendRequestCount } = storeToRefs(contactStore)

function badgeOf(n: number): string {
  if (n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

const chatBadge = computed(() => badgeOf(totalUnread.value))
const contactsBadge = computed(() => badgeOf(pendingFriendRequestCount.value))

const contactsIcon = computed(() =>
  props.current === 'contacts'
    ? '/static/tab/contacts-active.svg'
    : '/static/tab/contacts.svg',
)
const chatIcon = computed(() =>
  props.current === 'chat' ? '/static/tab/chat-active.svg' : '/static/tab/chat.svg',
)
const mineIcon = computed(() =>
  props.current === 'mine' ? '/static/tab/mine-active.svg' : '/static/tab/mine.svg',
)

function switchTo(url: string) {
  uni.switchTab({ url })
}
</script>

<template>
  <view class="tabbar">
    <view
      class="tab"
      :class="{ active: current === 'contacts' }"
      @click="switchTo('/pages/contacts/index')"
    >
      <view class="icon-wrap">
        <image class="icon" :src="contactsIcon" mode="aspectFit" />
        <view v-if="contactsBadge" class="badge">
          <text class="badge-text">{{ contactsBadge }}</text>
        </view>
      </view>
      <text class="label">通讯录</text>
    </view>

    <view
      class="tab"
      :class="{ active: current === 'chat' }"
      @click="switchTo('/pages/chat/index')"
    >
      <view class="icon-wrap">
        <image class="icon" :src="chatIcon" mode="aspectFit" />
        <view v-if="chatBadge" class="badge">
          <text class="badge-text">{{ chatBadge }}</text>
        </view>
      </view>
      <text class="label">聊天</text>
    </view>

    <view
      class="tab"
      :class="{ active: current === 'mine' }"
      @click="switchTo('/pages/mine/index')"
    >
      <image class="icon" :src="mineIcon" mode="aspectFit" />
      <text class="label">我的</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  height: 112rpx;
  padding: 16rpx 0;
  padding-bottom: calc(16rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -2rpx 6rpx rgba(23, 23, 23, 0.05);
  box-sizing: content-box;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 120rpx;
  color: #212121;
}

.tab.active {
  color: #0a2fc2;
}

.icon-wrap {
  position: relative;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  width: 48rpx;
  height: 48rpx;
}

.label {
  margin-top: 4rpx;
  font-size: 24rpx;
  line-height: 32rpx;
  color: inherit;
}

.badge {
  position: absolute;
  top: -10rpx;
  right: -18rpx;
  min-width: 32rpx;
  height: 32rpx;
  padding: 0 8rpx;
  border-radius: 16rpx;
  background: #ef4343;
  display: flex;
  align-items: center;
  justify-content: center;
}

.badge-text {
  color: #fff;
  font-size: 18rpx;
  line-height: 1;
}
</style>
