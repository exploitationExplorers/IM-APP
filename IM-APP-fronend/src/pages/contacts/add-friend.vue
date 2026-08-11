<script setup lang="ts">
import { ref } from 'vue'
import { useContactStore } from '@/stores/contact'
import { searchUserByPublicId } from '@/api/user'
import type { UserInfo } from '@/types'

const contactStore = useContactStore()
const publicId = ref('')
const message = ref('你好，我想加你为好友')
const loading = ref(false)
const result = ref<UserInfo | null>(null)
const searched = ref(false)

async function onSearch() {
  if (!publicId.value.trim()) {
    uni.showToast({ title: '请输入公开 ID', icon: 'none' })
    return
  }
  loading.value = true
  searched.value = true
  try {
    result.value = await searchUserByPublicId(publicId.value.trim())
    if (!result.value) {
      uni.showToast({ title: '未找到用户', icon: 'none' })
    }
  } catch (e) {
    result.value = null
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function viewProfile() {
  if (!result.value) return
  uni.navigateTo({ url: `/pages/contacts/user-profile?id=${result.value.id}` })
}

async function onSendRequest() {
  if (!result.value) return
  try {
    await contactStore.addFriend(result.value.id, message.value)
    uni.showToast({ title: '已发送好友申请', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 500)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="search-box">
      <input
        class="input"
        v-model="publicId"
        placeholder="输入公开 ID 搜索（如 chat10002）"
        placeholder-style="color:#999"
      />
      <button class="btn" :loading="loading" @click="onSearch">搜索</button>
    </view>

    <view v-if="result" class="result-card">
      <image class="avatar" :src="result.avatar || '/static/avatar-me.png'" mode="aspectFill" />
      <view class="info">
        <text class="name">{{ result.nickname }}</text>
        <text class="pid">ID: {{ result.publicId }}</text>
      </view>
      <text class="link" @click="viewProfile">查看资料 ›</text>
    </view>

    <view v-if="result" class="form">
      <text class="label">验证信息</text>
      <input class="msg-input" v-model="message" placeholder="填写验证说明" />
      <button class="send-btn" @click="onSendRequest">发送好友申请</button>
    </view>

    <view v-if="searched && !result && !loading" class="empty">
      <text>未找到该用户，请确认公开 ID 是否正确</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding: 24rpx;
}

.search-box {
  display: flex;
  gap: 16rpx;
  background: #fff;
  padding: 20rpx;
  border-radius: 12rpx;
}

.input {
  flex: 1;
  font-size: 28rpx;
}

.btn {
  background: #2b5cff;
  color: #fff;
  font-size: 26rpx;
  padding: 0 24rpx;
  line-height: 64rpx;
  height: 64rpx;
}

.btn::after {
  border: none;
}

.result-card {
  display: flex;
  align-items: center;
  background: #fff;
  margin-top: 24rpx;
  padding: 28rpx;
  border-radius: 12rpx;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background: #eee;
}

.info {
  flex: 1;
}

.name {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
}

.pid {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #999;
}

.link {
  color: #2b5cff;
  font-size: 26rpx;
}

.form {
  background: #fff;
  margin-top: 24rpx;
  padding: 28rpx;
  border-radius: 12rpx;
}

.label {
  font-size: 26rpx;
  color: #666;
}

.msg-input {
  margin-top: 16rpx;
  padding: 16rpx;
  background: #f5f6f8;
  border-radius: 8rpx;
  font-size: 28rpx;
}

.send-btn {
  margin-top: 32rpx;
  background: #2b5cff;
  color: #fff;
  border-radius: 12rpx;
}

.send-btn::after {
  border: none;
}

.empty {
  text-align: center;
  color: #999;
  font-size: 26rpx;
  margin-top: 80rpx;
}
</style>
