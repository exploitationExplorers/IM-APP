<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import EmptyState from '@/components/EmptyState.vue'
import { approveJoinRequest, fetchJoinRequests, rejectJoinRequest } from '@/api/group'
import type { GroupJoinRequestItem } from '@/types'

const groupId = ref('')
const keyword = ref('')
const loaded = ref(false)
const items = ref<GroupJoinRequestItem[]>([])

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return items.value
  return items.value.filter((item) => {
    const name = item.applicant.nickname || ''
    return name.toLowerCase().includes(text) || (item.remark || '').toLowerCase().includes(text)
  })
})

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  await reload()
})

async function reload() {
  if (!groupId.value) return
  try {
    items.value = await fetchJoinRequests(groupId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  } finally {
    loaded.value = true
  }
}

function goBack() {
  uni.navigateBack()
}

async function onAccept(item: GroupJoinRequestItem) {
  try {
    await approveJoinRequest(groupId.value, item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
    uni.showToast({ title: '已接受', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '操作失败', icon: 'none' })
  }
}

async function onReject(item: GroupJoinRequestItem) {
  try {
    await rejectJoinRequest(groupId.value, item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
    uni.showToast({ title: '已拒绝', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '操作失败', icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">入群申请</text>
      <view class="nav-space" />
    </view>

    <view class="search-wrap">
      <view class="search-box">
        <text class="search-icon">⌕</text>
        <input class="search-input" v-model="keyword" placeholder="搜索" confirm-type="search" />
      </view>
    </view>

    <text class="section-title">近期请求</text>

    <view v-for="item in filtered" :key="item.id" class="row">
      <view class="main">
        <image class="avatar" :src="item.applicant.avatar" mode="aspectFill" />
        <text class="name">{{ item.applicant.nickname }}</text>
        <text class="reject" @click="onReject(item)">拒绝</text>
        <text class="accept" @click="onAccept(item)">接受</text>
      </view>
      <text v-if="item.remark" class="msg">{{ item.remark }}</text>
    </view>

    <EmptyState v-if="loaded && !filtered.length" text="暂无入群申请" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.nav {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 26rpx;
}

.nav-back,
.nav-space {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.search-wrap {
  padding: 8rpx 24rpx 8rpx;
}

.search-box {
  height: 72rpx;
  border-radius: 8rpx;
  background: #f3f4f7;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  gap: 12rpx;
}

.search-icon {
  color: #8a8f9c;
}

.search-input {
  flex: 1;
  height: 72rpx;
  font-size: 28rpx;
}

.section-title {
  display: block;
  padding: 28rpx 32rpx 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #212121;
}

.row {
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

.reject,
.accept {
  font-size: 26rpx;
  padding: 10rpx 20rpx;
  border-radius: 8rpx;
}

.reject {
  color: #8a8f9c;
  margin-right: 12rpx;
}

.accept {
  color: #0a2fc2;
  border: 1rpx solid #0a2fc2;
}

.msg {
  display: block;
  margin-top: 12rpx;
  margin-left: 108rpx;
  padding: 16rpx 20rpx;
  font-size: 24rpx;
  color: #8a8f9c;
  background: #f5f5f5;
  border-radius: 8rpx;
}
</style>
