<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { APP_CONFIG } from '@/config'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useChatStore } from '@/stores/chat'
import { useContactStore } from '@/stores/contact'
import { useUserStore } from '@/stores/user'
import type { Contact } from '@/types'
import { imUserId } from '@/utils/openim'
import { getStatusBarHeight } from '@/utils/status-bar'

useAuthGuard()

/** 选择好友发名片：从聊天页加号面板进入，选中即发送并返回 */
const chatStore = useChatStore()
const contactStore = useContactStore()
const userStore = useUserStore()

const statusBarHeight = getStatusBarHeight()
const conversationId = ref('')
const conversationTitle = ref('')
const keyword = ref('')
const loading = ref(false)
const sending = ref(false)

onLoad(async (query) => {
  conversationId.value = String(query?.conversationId || '')
  conversationTitle.value = decodeURIComponent(String(query?.title || ''))
  if (!conversationId.value) {
    uni.showToast({ title: '缺少会话信息', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  loading.value = true
  try {
    await contactStore.reloadContacts({ keyword: '', sort: 'recent' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '好友列表加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return contactStore.contacts
  return contactStore.contacts.filter((c) =>
    `${c.nickname} ${c.remark || ''}`.toLowerCase().includes(text),
  )
})

function displayName(contact: Contact) {
  return contact.remark?.trim() || contact.nickname
}

async function onPick(contact: Contact) {
  if (sending.value || !conversationId.value) return
  sending.value = true
  try {
    await chatStore.sendCard(
      conversationId.value,
      // 名片对外展示对方昵称，不携带我的好友备注
      { id: contact.id, nickname: contact.nickname, avatar: contact.avatar },
      imUserId.value || userStore.profile?.id || '',
    )
    uni.showToast({ title: '已发送', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 400)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '发送失败', icon: 'none' })
    sending.value = false
  }
}

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">选择好友</text>
      <view class="header-pad"></view>
    </view>

    <view v-if="conversationTitle" class="target-bar">
      <text class="target-text">发送给：{{ conversationTitle }}</text>
    </view>

    <AppSearchBar v-model="keyword" placeholder="搜索好友" />

    <scroll-view scroll-y class="list">
      <text v-if="loading" class="loading">加载中...</text>
      <view
        v-for="contact in filtered"
        :key="contact.id"
        class="contact-row"
        @click="onPick(contact)"
      >
        <image
          class="avatar"
          :src="contact.avatar || APP_CONFIG.defaultAvatarUrl"
          mode="aspectFill"
        />
        <text class="name">{{ displayName(contact) }}</text>
        <view class="pick-btn" :class="{ disabled: sending }">
          <text class="pick-btn-text">{{ sending ? '发送中' : '发送' }}</text>
        </view>
      </view>
      <text v-if="!loading && !filtered.length" class="empty">暂无好友</text>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 32rpx;
  box-sizing: content-box;
  background: #fff;
}

.back-btn {
  font-size: 56rpx;
  color: #212121;
  width: 88rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #212121;
}

.header-pad {
  width: 88rpx;
}

.target-bar {
  padding: 8rpx 40rpx 16rpx;
}

.target-text {
  font-size: 26rpx;
  color: #8a8f9c;
}

.list {
  flex: 1;
  padding: 0 0 28rpx;
}

.contact-row {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 20rpx 40rpx;
}

.avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 12rpx;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 32rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-btn {
  min-width: 104rpx;
  height: 60rpx;
  padding: 0 24rpx;
  border-radius: 999rpx;
  background: #2b5cff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pick-btn.disabled {
  opacity: 0.6;
}

.pick-btn-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #fff;
  line-height: 1;
}

.empty,
.loading {
  display: block;
  padding: 120rpx 20rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
