<script setup lang="ts">
import { ref } from 'vue'
import { useContactStore } from '@/stores/contact'
import { searchUserByPublicId } from '@/api/user'
import type { UserInfo } from '@/types'

const contactStore = useContactStore()
const keyword = ref('')
const message = ref('你好，我想加你为好友')
const loading = ref(false)
const result = ref<UserInfo | null>(null)
const searched = ref(false)

async function onSearch() {
  const id = keyword.value.trim()
  if (!id) {
    uni.showToast({ title: '请输入聊天号', icon: 'none' })
    return
  }
  loading.value = true
  searched.value = true
  try {
    result.value = await searchUserByPublicId(id)
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

function goBack() {
  uni.navigateBack()
}

function goScan() {
  uni.navigateTo({ url: '/pages/contacts/scan' })
}

function viewProfile() {
  if (!result.value) return
  uni.navigateTo({ url: `/pages/contacts/user-profile?id=${result.value.id}` })
}

async function onSendRequest() {
  if (!result.value) return
  try {
    const res = await contactStore.addFriend(result.value.id, message.value)
    uni.showToast({
      title: res.status === 'accepted' ? '已添加好友' : '已发送好友申请',
      icon: 'success',
    })
    setTimeout(() => uni.navigateBack(), 500)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="navbar">
      <view class="nav-btn" @click="goBack">
        <image class="nav-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">添加朋友</text>
      <view class="nav-btn" @click="goScan">
        <image class="nav-icon" src="/static/icons/icon-scan.svg" mode="aspectFit" />
      </view>
    </view>

    <view class="search-wrap">
      <view class="search-box">
        <text class="search-glyph">⌕</text>
        <input
          class="search-input"
          v-model="keyword"
          placeholder="搜索聊天号"
          placeholder-class="search-ph"
          confirm-type="search"
          @confirm="onSearch"
        />
      </view>
    </view>

    <scroll-view scroll-y class="body">
      <view v-if="result" class="result-card" @click="viewProfile">
        <image class="avatar" :src="result.avatar || '/static/avatar-me.png'" mode="aspectFill" />
        <view class="info">
          <text class="name">{{ result.nickname }}</text>
          <text class="pid">聊天号: {{ result.publicId }}</text>
        </view>
        <image class="arrow" src="/static/icons/icon-chevron.svg" mode="aspectFit" />
      </view>

      <view v-if="result" class="form">
        <text class="label">验证信息</text>
        <input class="msg-input" v-model="message" placeholder="填写验证说明" placeholder-class="search-ph" />
        <view class="send-btn" @click="onSendRequest">发送好友申请</view>
      </view>

      <view v-if="searched && !result && !loading" class="empty">
        <text>未找到该用户，请确认聊天号是否正确</text>
      </view>
    </scroll-view>

    <view class="footer">
      <view class="primary-btn" :class="{ disabled: loading }" @click="onSearch">
        {{ loading ? '搜索中...' : '搜索' }}
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.navbar {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 40rpx;
  gap: 16rpx;
  background: #fff;
}

.nav-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-icon {
  width: 48rpx;
  height: 48rpx;
}

.nav-title {
  flex: 1;
  font-size: 48rpx;
  font-weight: 700;
  color: #212121;
  line-height: 64rpx;
  text-align: left;
}

.search-wrap {
  padding: 16rpx 40rpx 24rpx;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 72rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
}

.search-glyph {
  color: #626e8d;
  font-size: 30rpx;
  line-height: 1;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #212121;
  height: 72rpx;
}

.search-ph {
  color: #626e8d;
}

.body {
  flex: 1;
  height: 0;
  padding: 0 40rpx;
  box-sizing: border-box;
}

.result-card {
  display: flex;
  align-items: center;
  gap: 32rpx;
  padding: 24rpx 0;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.info {
  flex: 1;
  min-width: 0;
}

.name {
  display: block;
  font-size: 34rpx;
  color: #212121;
  line-height: 48rpx;
}

.pid {
  display: block;
  margin-top: 4rpx;
  font-size: 24rpx;
  color: #626e8d;
}

.arrow {
  width: 40rpx;
  height: 40rpx;
  flex-shrink: 0;
}

.form {
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid #f3f4f7;
}

.label {
  font-size: 28rpx;
  color: #626e8d;
}

.msg-input {
  margin-top: 16rpx;
  height: 80rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
  font-size: 28rpx;
  color: #212121;
}

.send-btn {
  margin-top: 32rpx;
  height: 96rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty {
  text-align: center;
  color: #626e8d;
  font-size: 26rpx;
  margin-top: 80rpx;
}

.footer {
  padding: 16rpx 40rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
}

.primary-btn {
  height: 96rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.primary-btn.disabled {
  opacity: 0.7;
}
</style>
