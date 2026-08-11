<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ChatBubble from '@/components/ChatBubble.vue'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'

const chatStore = useChatStore()
const userStore = useUserStore()

const conversationId = ref('')
const title = ref('聊天')
const peerAvatar = ref('/static/avatar-1.png')
const input = ref('')
const scrollInto = ref('')
const showPlusPanel = ref(false)

const messages = computed(() => chatStore.messagesMap[conversationId.value] || [])
const myId = computed(() => userStore.profile?.id || 'u_me')
const myAvatar = computed(() => userStore.profile?.avatar || '/static/avatar-me.png')

onLoad(async (query) => {
  conversationId.value = String(query?.id || '')
  title.value = decodeURIComponent(String(query?.title || '聊天'))
  peerAvatar.value = decodeURIComponent(String(query?.avatar || '/static/avatar-1.png'))
  uni.setNavigationBarTitle({ title: title.value })
  await chatStore.loadMessages(conversationId.value)
  await nextTick()
  scrollToBottom()
})

function scrollToBottom() {
  const list = messages.value
  if (!list.length) return
  scrollInto.value = `msg_${list[list.length - 1].id}`
}

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

function onVoice() {
  uni.showToast({ title: '语音功能开发中', icon: 'none' })
}

function onEmoji() {
  uni.showToast({ title: '表情面板开发中', icon: 'none' })
}

function onPlus() {
  showPlusPanel.value = !showPlusPanel.value
}

function pickImage() {
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      const path = res.tempFilePaths[0]
      showPlusPanel.value = false
      // mock：直接作为图片消息发送
      const { sendMessage } = await import('@/api/chat')
      const saved = await sendMessage(conversationId.value, 'image', path)
      const list = chatStore.messagesMap[conversationId.value] || []
      chatStore.messagesMap = {
        ...chatStore.messagesMap,
        [conversationId.value]: [...list, saved],
      }
      await nextTick()
      scrollToBottom()
    },
  })
}
</script>

<template>
  <view class="room">
    <scroll-view
      scroll-y
      class="msg-list"
      :scroll-into-view="scrollInto"
      scroll-with-animation
    >
      <view
        v-for="m in messages"
        :id="`msg_${m.id}`"
        :key="m.id"
      >
        <ChatBubble
          :message="m"
          :mine="m.senderId === myId"
          :avatar="m.senderId === myId ? myAvatar : peerAvatar"
        />
      </view>
    </scroll-view>

    <view class="composer safe-bottom">
      <view class="composer-row">
        <view class="tool" @click="onVoice">🎙</view>
        <view class="input-wrap">
          <input
            class="input"
            v-model="input"
            confirm-type="send"
            placeholder="输入消息"
            placeholder-style="color:#B0B0B0"
            @confirm="onSend"
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

.msg-list {
  flex: 1;
  height: 0;
  padding-bottom: 16rpx;
}

.composer {
  background: #f7f7f7;
  border-top: 1rpx solid #e8e8e8;
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
