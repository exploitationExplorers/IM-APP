<script setup lang="ts">
import { computed, ref } from 'vue'
import { onReachBottom, onShow } from '@dcloudio/uni-app'
import { storeToRefs } from 'pinia'
import EmptyState from '@/components/EmptyState.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { APP_CONFIG } from '@/config'
import { formatRelativeTime } from '@/utils/format'
import type { FriendRequest } from '@/types'

const PAGE_SIZE = 20

useAuthGuard()
const contactStore = useContactStore()
const { pendingFriendRequests, recentFriendRequests } = storeToRefs(contactStore)
const loaded = ref(false)
const recentVisibleCount = ref(PAGE_SIZE)

const hasMoreRecent = computed(
  () => recentVisibleCount.value < recentFriendRequests.value.length,
)

const visibleRecent = computed(() =>
  recentFriendRequests.value.slice(0, recentVisibleCount.value),
)

const showEmpty = computed(
  () =>
    loaded.value &&
    !pendingFriendRequests.value.length &&
    !recentFriendRequests.value.length,
)

onShow(async () => {
  await contactStore.loadFriendRequests()
  loaded.value = true
})

onReachBottom(() => {
  if (hasMoreRecent.value) {
    recentVisibleCount.value += PAGE_SIZE
  }
})

function messageOf(item: FriendRequest): string {
  const text = item.message?.trim()
  if (text) return text
  const name = item.fromUser.nickname?.trim() || '用户'
  return `你好，我是 ${name}`
}

function recentActionLabel(item: FriendRequest): string {
  return item.status === 'rejected' ? '拒绝' : '同意'
}

async function onAccept(id: string) {
  try {
    await contactStore.acceptRequest(id)
    uni.showToast({ title: '已添加', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

async function onReject(id: string) {
  try {
    await contactStore.rejectRequest(id)
    uni.showToast({ title: '已拒绝', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view v-if="pendingFriendRequests.length" class="section">
      <view class="section-title">待处理</view>
      <view v-for="item in pendingFriendRequests" :key="item.id" class="row">
        <view class="row-main">
          <image
            class="avatar"
            :src="item.fromUser.avatar || APP_CONFIG.defaultAvatarUrl"
            mode="aspectFill"
          />
          <view class="info">
            <text class="name">{{ item.fromUser.nickname }}</text>
            <text class="time">{{ formatRelativeTime(item.createdAt) }}</text>
          </view>
          <view class="actions">
            <text class="btn-reject" @click="onReject(item.id)">拒绝</text>
            <text class="btn-accept" @click="onAccept(item.id)">同意</text>
          </view>
        </view>
        <text class="msg">{{ messageOf(item) }}</text>
      </view>
    </view>

    <view v-if="recentFriendRequests.length" class="section">
      <view class="section-title">近期请求</view>
      <view v-for="item in visibleRecent" :key="item.id" class="row">
        <view class="row-main">
          <image
            class="avatar"
            :src="item.fromUser.avatar || APP_CONFIG.defaultAvatarUrl"
            mode="aspectFill"
          />
          <view class="info">
            <text class="name">{{ item.fromUser.nickname }}</text>
            <text class="time">{{ formatRelativeTime(item.createdAt) }}</text>
          </view>
          <text class="btn-done">{{ recentActionLabel(item) }}</text>
        </view>
        <text class="msg">{{ messageOf(item) }}</text>
      </view>
      <view v-if="hasMoreRecent" class="load-more">上拉加载更多</view>
      <view v-else class="load-more">没有更多了</view>
    </view>

    <EmptyState v-if="showEmpty" text="" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.section + .section {
  margin-top: 8rpx;
}

.section-title {
  padding: 28rpx 32rpx 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #212121;
}

.row {
  padding: 24rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.row-main {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  flex-shrink: 0;
  background: #eee;
}

.info {
  flex: 1;
  min-width: 0;
  padding-top: 4rpx;
}

.name {
  display: block;
  font-size: 30rpx;
  color: #212121;
  line-height: 42rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  display: block;
  margin-top: 4rpx;
  font-size: 24rpx;
  color: #9aa3b5;
  line-height: 34rpx;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex-shrink: 0;
  padding-top: 8rpx;
}

.btn-reject,
.btn-accept,
.btn-done {
  font-size: 26rpx;
  line-height: 1;
  padding: 12rpx 24rpx;
  border-radius: 8rpx;
  white-space: nowrap;
}

.btn-reject {
  color: #ef4343;
  border: 1rpx solid #ef4343;
}

.btn-accept {
  color: #0a2fc2;
  border: 1rpx solid #0a2fc2;
}

.btn-done {
  color: #b0b3bd;
  border: 1rpx solid #d8dbe3;
  background: #f7f7f7;
}

.msg {
  display: block;
  margin-top: 16rpx;
  margin-left: 108rpx;
  padding: 16rpx 20rpx;
  font-size: 26rpx;
  color: #636e86;
  background: #f3f4f7;
  border-radius: 8rpx;
  word-break: break-all;
}

.load-more {
  padding: 24rpx 0 32rpx;
  text-align: center;
  font-size: 24rpx;
  color: #b0b3bd;
}
</style>
