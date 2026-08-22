<script setup lang="ts">
import { computed, ref } from 'vue'
import { onReachBottom, onShow } from '@dcloudio/uni-app'
import EmptyState from '@/components/EmptyState.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'

const PAGE_SIZE = 20

useAuthGuard()
const contactStore = useContactStore()
const loaded = ref(false)
const visibleCount = ref(PAGE_SIZE)

const visibleRequests = computed(() =>
  contactStore.friendRequests.slice(0, visibleCount.value)
)
const hasMore = computed(
  () => visibleCount.value < contactStore.friendRequests.length
)

onShow(async () => {
  await contactStore.loadFriendRequests()
  loaded.value = true
})

onReachBottom(() => {
  if (hasMore.value) {
    visibleCount.value += PAGE_SIZE
  }
})

async function onAccept(id: string) {
  try {
    await contactStore.acceptRequest(id)
    uni.showToast({ title: '已添加', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="section-title">近期请求</view>
    <view
      v-for="item in visibleRequests"
      :key="item.id"
      class="row"
    >
      <view class="main">
        <image class="avatar" :src="item.fromUser.avatar || '/static/avatar-me.png'" mode="aspectFill" />
        <text class="name">{{ item.fromUser.nickname }}</text>
        <text class="accept" @click="onAccept(item.id)">接受</text>
      </view>
      <text class="msg">{{ item.message }}</text>
    </view>
    <view v-if="hasMore" class="load-more">上拉加载更多</view>
    <view v-else-if="visibleRequests.length" class="load-more">没有更多了</view>
    <EmptyState v-if="loaded && !contactStore.friendRequests.length" text="" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.section-title {
  padding: 28rpx 32rpx 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #212121;
}

.row {
  background: #fff;
  padding: 24rpx 28rpx;
}

.main {
  display: flex;
  align-items: center;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background: #eee;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.accept {
  color: #0a2fc2;
  font-size: 26rpx;
  padding: 10rpx 20rpx;
  border: 1rpx solid #0a2fc2;
  border-radius: 8rpx;
}

.msg {
  display: block;
  margin-top: 12rpx;
  padding: 16rpx 20rpx;
  font-size: 24rpx;
  color: #8a8f9c;
  background: #f5f5f5;
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
