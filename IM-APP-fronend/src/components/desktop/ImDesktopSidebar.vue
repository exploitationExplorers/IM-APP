<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useUserStore } from '@/stores/user'
import { readFriendRequestBadge } from '@/utils/friend-request-badge'
import { APP_CONFIG } from '@/config'

const props = defineProps<{
  current: 'contacts' | 'chat' | 'mine'
}>()

const chatStore = useChatStore()
const contactStore = useContactStore()
const userStore = useUserStore()
const { totalUnread } = storeToRefs(chatStore)
const { pendingFriendRequestCount } = storeToRefs(contactStore)

const avatar = computed(
  () => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl,
)

function badgeOf(n: number): string {
  if (n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

const chatBadge = computed(() => badgeOf(totalUnread.value))
const contactsBadge = computed(() =>
  badgeOf(Math.max(pendingFriendRequestCount.value, readFriendRequestBadge())),
)

function switchTo(url: string) {
  uni.switchTab({ url })
}

function openProfile() {
  uni.switchTab({ url: '/pages/mine/index' })
}
</script>

<template>
  <view class="sidebar">
    <view class="avatar-wrap" @click="openProfile">
      <image class="avatar" :src="avatar" mode="aspectFill" />
    </view>

    <view class="nav-group">
      <view
        class="nav-item"
        :class="{ active: current === 'contacts' }"
        @click="switchTo('/pages/contacts/index')"
      >
        <view class="icon-wrap">
          <image
            class="icon"
            :src="current === 'contacts' ? '/static/tab/contacts-active.svg' : '/static/tab/contacts.svg'"
            mode="aspectFit"
          />
          <view v-if="contactsBadge" class="badge">
            <text class="badge-text">{{ contactsBadge }}</text>
          </view>
        </view>
      </view>

      <view
        class="nav-item"
        :class="{ active: current === 'chat' }"
        @click="switchTo('/pages/chat/index')"
      >
        <view class="icon-wrap">
          <image
            class="icon"
            :src="current === 'chat' ? '/static/tab/chat-active.svg' : '/static/tab/chat.svg'"
            mode="aspectFit"
          />
          <view v-if="chatBadge" class="badge">
            <text class="badge-text">{{ chatBadge }}</text>
          </view>
        </view>
      </view>
    </view>

    <view
      class="nav-item bottom"
      :class="{ active: current === 'mine' }"
      @click="switchTo('/pages/mine/index')"
    >
      <image
        class="icon"
        :src="current === 'mine' ? '/static/tab/mine-active.svg' : '/static/tab/mine.svg'"
        mode="aspectFit"
      />
    </view>
  </view>
</template>

<style scoped lang="scss">
.sidebar {
  width: 72px;
  flex-shrink: 0;
  height: 100vh;
  height: 100dvh;
  background: #0a2fc2;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  box-sizing: border-box;
}

.avatar-wrap {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}

.nav-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.nav-item {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.nav-item.active {
  background: rgba(255, 255, 255, 0.18);
}

.nav-item.bottom {
  margin-top: auto;
}

.icon-wrap {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  width: 28px;
  height: 28px;
  filter: brightness(0) invert(1);
}

.nav-item.active .icon {
  filter: brightness(0) invert(1);
}

.badge {
  position: absolute;
  top: -6px;
  right: -10px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #ef4343;
  display: flex;
  align-items: center;
  justify-content: center;
}

.badge-text {
  color: #fff;
  font-size: 10px;
  line-height: 1;
}
</style>
