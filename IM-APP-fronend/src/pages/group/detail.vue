<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'

const groupStore = useGroupStore()
const userStore = useUserStore()
const { currentGroup, members } = storeToRefs(groupStore)

const groupId = ref('')
const announcement = ref('')
const allowAddFriend = ref(true)
const loading = ref(true)

const isOwner = computed(() => currentGroup.value?.ownerId === userStore.profile?.id)

onLoad((query) => {
  groupId.value = (query?.id as string) || ''
})

onMounted(async () => {
  if (!groupId.value) return
  try {
    await userStore.loadProfile()
    await groupStore.loadDetail(groupId.value)
    announcement.value = currentGroup.value?.announcement || ''
    allowAddFriend.value = currentGroup.value?.allowMemberAddFriend ?? true
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
})

function openChat() {
  const g = currentGroup.value
  if (!g?.conversationId) {
    uni.showToast({ title: '暂无群会话', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/chat/room?id=${g.conversationId}&title=${encodeURIComponent(g.name)}`,
  })
}

async function onSaveSettings() {
  if (!isOwner.value) return
  uni.showLoading({ title: '保存中...', mask: true })
  try {
    await groupStore.updateSettings(groupId.value, {
      announcement: announcement.value,
      allowMemberAddFriend: allowAddFriend.value,
    })
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function onAllowAddFriendChange(e: any) {
  allowAddFriend.value = e.detail.value as boolean
}

async function onLeave() {
  uni.showModal({
    title: '提示',
    content: '确定退出该群聊吗？',
    success: async (res) => {
      if (!res.confirm) return
      await groupStore.leave(groupId.value)
      uni.navigateBack()
    },
  })
}
</script>

<template>
  <view class="page">
    <view v-if="currentGroup && !loading" class="card">
      <image class="avatar" :src="currentGroup.avatar || '/static/group-1.png'" mode="aspectFill" />
      <text class="name">{{ currentGroup.name }}</text>
      <text class="meta">{{ currentGroup.memberCount }} 人</text>
      <button class="btn primary" @click="openChat">进入群聊</button>
    </view>

    <view v-if="currentGroup && !loading" class="section">
      <text class="section-title">群公告</text>
      <textarea
        class="textarea"
        v-model="announcement"
        :disabled="!isOwner"
        placeholder="暂无公告"
      />
    </view>

    <view v-if="currentGroup && isOwner && !loading" class="section row-switch">
      <text>允许成员互加好友</text>
      <switch :checked="allowAddFriend" @change="onAllowAddFriendChange" />
    </view>

    <view v-if="isOwner && !loading" class="actions">
      <button class="btn" @click="onSaveSettings">保存设置</button>
    </view>

    <view v-if="members.length && !loading" class="section">
      <text class="section-title">群成员（{{ members.length }}）</text>
      <view v-for="m in members" :key="m.id" class="member-row">
        <image class="m-avatar" :src="m.avatar || '/static/avatar-me.png'" mode="aspectFill" />
        <text class="m-name">{{ m.nickname }}</text>
        <text class="role">{{ m.role === 'owner' ? '群主' : m.role === 'admin' ? '管理员' : '' }}</text>
      </view>
    </view>

    <button v-if="!loading" class="btn danger" @click="onLeave">退出群聊</button>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding-bottom: 48rpx;
}

.card {
  background: #fff;
  margin: 24rpx;
  border-radius: 16rpx;
  padding: 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 16rpx;
  background: #eee;
}

.name {
  margin-top: 20rpx;
  font-size: 34rpx;
  font-weight: 600;
}

.meta {
  margin-top: 8rpx;
  color: #999;
  font-size: 24rpx;
}

.section {
  background: #fff;
  margin: 0 24rpx 16rpx;
  border-radius: 16rpx;
  padding: 24rpx;
}

.section-title {
  font-size: 26rpx;
  color: #666;
  margin-bottom: 16rpx;
  display: block;
}

.textarea {
  width: 100%;
  min-height: 120rpx;
  font-size: 28rpx;
}

.row-switch {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 28rpx;
}

.member-row {
  display: flex;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f3f3f3;
}

.m-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  margin-right: 16rpx;
}

.m-name {
  flex: 1;
  font-size: 28rpx;
}

.role {
  color: #2b5cff;
  font-size: 22rpx;
}

.btn {
  margin-top: 24rpx;
  border-radius: 12rpx;
  width: 100%;
}

.btn.primary {
  background: #2b5cff;
  color: #fff;
}

.btn.danger {
  margin: 24rpx;
  background: #fff;
  color: #e54d42;
  border: 1rpx solid #e54d42;
}

.btn::after {
  border: none;
}

.actions {
  padding: 0 24rpx;
}
</style>
