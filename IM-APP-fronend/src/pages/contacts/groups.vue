<script setup lang="ts">
import { onMounted } from 'vue'
import { useContactStore } from '@/stores/contact'
import EmptyState from '@/components/EmptyState.vue'

const contactStore = useContactStore()

onMounted(() => {
  contactStore.loadAll()
})

function openGroup(id: string) {
  uni.navigateTo({ url: `/pages/group/detail?id=${id}` })
}

function goCreate() {
  uni.navigateTo({ url: '/pages/group/create' })
}
</script>

<template>
  <view class="page">
    <view class="create-row" @click="goCreate">
      <view class="create-icon">＋</view>
      <text>创建群聊</text>
    </view>
    <view
      v-for="g in contactStore.groups"
      :key="g.id"
      class="row"
      @click="openGroup(g.id)"
    >
      <image class="avatar" :src="g.avatar || '/static/group-1.png'" mode="aspectFill" />
      <text class="name">{{ g.name }}</text>
      <text class="arrow">›</text>
    </view>
    <EmptyState v-if="!contactStore.groups.length" text="暂无群聊" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.create-row {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f3f3f3;
  color: #2b5cff;
  font-size: 30rpx;
}

.create-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #2b5cff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
  font-size: 36rpx;
}

.row {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
  border-bottom: 1rpx solid #f3f3f3;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 12rpx;
  margin-right: 20rpx;
  background: #eee;
}

.name {
  flex: 1;
  font-size: 30rpx;
}

.arrow {
  color: #ccc;
  font-size: 36rpx;
}
</style>
