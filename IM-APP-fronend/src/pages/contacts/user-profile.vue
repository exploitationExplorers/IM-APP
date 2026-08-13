<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchUserProfile } from '@/api/user'
import { useContactStore } from '@/stores/contact'
import type { UserInfo } from '@/types'

const contactStore = useContactStore()
const userId = ref('')
const user = ref<UserInfo | null>(null)
const message = ref('你好，我想加你为好友')
const loading = ref(false)

onLoad((query) => {
  userId.value = (query?.id as string) || ''
})

onMounted(async () => {
  await contactStore.loadAll()
  if (!userId.value) return
  loading.value = true
  try {
    user.value = await fetchUserProfile(userId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
})

const isFriend = () => contactStore.contacts.some((c) => c.id === userId.value)

async function onAddFriend() {
  if (!user.value) return
  try {
    const res = await contactStore.addFriend(user.value.id, message.value)
    uni.showToast({
      title: res.status === 'accepted' ? '已添加好友' : '已发送好友申请',
      icon: 'success',
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

async function onChat() {
  if (!user.value) return
  await contactStore.openChatWithContact(user.value.id, user.value.nickname, user.value.avatar)
}
</script>

<template>
  <view class="page">
    <view v-if="user" class="card">
      <image class="avatar" :src="user.avatar || '/static/avatar-me.png'" mode="aspectFill" />
      <text class="name">{{ user.nickname }}</text>
      <text class="pid">公开 ID: {{ user.publicId }}</text>
      <text v-if="user.bio" class="bio">{{ user.bio }}</text>
    </view>

    <view v-if="user && !isFriend()" class="form">
      <input class="input" v-model="message" placeholder="验证信息" />
      <button class="btn primary" @click="onAddFriend">加好友</button>
    </view>

    <view v-if="user && isFriend()" class="actions">
      <button class="btn primary" @click="onChat">发消息</button>
    </view>

    <view v-if="loading" class="loading">加载中...</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding: 32rpx;
}

.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 48rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.avatar {
  width: 140rpx;
  height: 140rpx;
  border-radius: 50%;
  background: #eee;
}

.name {
  margin-top: 24rpx;
  font-size: 36rpx;
  font-weight: 600;
}

.pid {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #999;
}

.bio {
  margin-top: 16rpx;
  font-size: 26rpx;
  color: #666;
}

.form, .actions {
  margin-top: 32rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 28rpx;
}

.input {
  padding: 20rpx;
  background: #f5f6f8;
  border-radius: 8rpx;
  font-size: 28rpx;
  margin-bottom: 24rpx;
}

.btn {
  border-radius: 12rpx;
}

.btn.primary {
  background: #2b5cff;
  color: #fff;
}

.btn::after {
  border: none;
}

.loading {
  text-align: center;
  color: #999;
  margin-top: 80rpx;
}
</style>
