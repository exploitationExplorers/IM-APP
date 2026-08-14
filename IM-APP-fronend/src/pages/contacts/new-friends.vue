<script setup lang="ts">
import { onMounted, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import { useContactStore } from '@/stores/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'

useAuthGuard()
const contactStore = useContactStore()
const loaded = ref(false)

onMounted(async () => {
  await contactStore.loadFriendRequests()
  loaded.value = true
})

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
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="section-title">近期请求</view>
    <view
      v-for="item in contactStore.friendRequests"
      :key="item.id"
      class="row"
    >
      <image class="avatar" :src="item.fromUser.avatar || '/static/avatar-me.png'" mode="aspectFill" />
      <view class="body">
        <text class="name">{{ item.fromUser.nickname }}</text>
        <text class="msg">{{ item.message }}</text>
      </view>
      <view class="btns">
        <text class="reject" @click="onReject(item.id)">拒绝</text>
        <text class="accept" @click="onAccept(item.id)">接受</text>
      </view>
    </view>
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
  display: flex;
  align-items: center;
  background: #fff;
  padding: 24rpx 28rpx;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  margin-right: 20rpx;
  background: #eee;
}

.body {
  flex: 1;
  min-width: 0;
}

.name {
  display: block;
  font-size: 30rpx;
  color: #212121;
}

.msg {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #8a8f9c;
}

.btns {
  display: flex;
  gap: 16rpx;
}

.accept {
  color: #0a2fc2;
  font-size: 26rpx;
  padding: 10rpx 20rpx;
  border: 1rpx solid #0a2fc2;
  border-radius: 8rpx;
}

.reject {
  color: #8a8f9c;
  font-size: 26rpx;
  padding: 10rpx 20rpx;
}
</style>
