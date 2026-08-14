<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useGroupStore } from '@/stores/group'

const groupStore = useGroupStore()
const groupId = ref('')
const announcement = ref('')

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }

  try {
    const detail = await groupStore.loadDetail(groupId.value)
    announcement.value = detail.announcement || '暂无群公告'
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群公告失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">群公告</text>
      <view class="nav-space" />
    </view>

    <view class="content">
      <text class="announcement">{{ announcement }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f5f5;
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 26rpx;
  background: #fff;
}

.nav-back {
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

.nav-space {
  width: 52rpx;
  height: 52rpx;
}

.content {
  background: #fff;
  margin-top: 18rpx;
  padding: 32rpx 28rpx;
  min-height: 240rpx;
}

.announcement {
  font-size: 30rpx;
  color: #2a2a2a;
  line-height: 1.8;
  white-space: pre-wrap;
}
</style>
