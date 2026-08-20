<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { fetchBlacklist, unblockContact, type BlockedUser } from '@/api/contact'
import { formatRelativeTime } from '@/utils/format'
import { THEME } from '@/config'

const list = ref<BlockedUser[]>([])
const loading = ref(false)
const keyword = ref('')

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return list.value
  return list.value.filter(
    (u) => u.nickname.toLowerCase().includes(k) || (u.publicId || '').toLowerCase().includes(k),
  )
})

async function loadList() {
  loading.value = true
  try {
    const res = await fetchBlacklist()
    list.value = res.items
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function onUnblock(item: BlockedUser) {
  uni.showModal({
    title: '解除黑名单',
    content: `确定将「${item.nickname || item.publicId}」移出黑名单吗？`,
    confirmText: '解除',
    confirmColor: THEME.danger,
    success: async (res) => {
      if (!res.confirm) return
      try {
        await unblockContact(item.id)
        list.value = list.value.filter((u) => u.id !== item.id)
        uni.showToast({ title: '已解除', icon: 'success' })
        // 通知通讯录页面刷新（如有订阅）
        // 简单做法：直接 reload 该用户的通讯录缓存
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '解除失败', icon: 'none' })
      }
    },
  })
}

onLoad(() => {
  loadList()
})
onPullDownRefresh(async () => {
  await loadList()
  uni.stopPullDownRefresh()
})
</script>

<template>
  <view class="page">
    <view class="search-wrap">
      <AppSearchBar v-model="keyword" placeholder="搜索" />
    </view>

    <scroll-view
      scroll-y
      class="list"
      refresher-enabled
      :refresher-triggered="loading"
      @refresherrefresh="onPullDownRefresh"
    >
      <view v-for="item in filtered" :key="item.id" class="item">
        <image class="avatar" :src="item.avatar || '/static/avatar-1.png'" mode="aspectFill" />
        <view class="meta">
          <text class="name">{{ item.nickname || item.publicId }}</text>
          <text class="time">拉黑于 {{ formatRelativeTime(item.blockedAt) }}</text>
        </view>
        <view class="action" @click="onUnblock(item)">
          <text>解除</text>
        </view>
      </view>
      <view v-if="!filtered.length && !loading" class="empty">
        <text>{{ list.length ? '无匹配结果' : '暂无黑名单' }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}

.search-wrap {
  padding-top: 8rpx;
}

.list {
  flex: 1;
  min-height: 0;
}

.item {
  display: flex;
  align-items: center;
  padding: 24rpx 40rpx;
  border-bottom: 1rpx solid #f0f1f4;
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  margin-right: 24rpx;
  background: #eee;
  flex-shrink: 0;
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.name {
  font-size: 30rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 24rpx;
  color: #8a8f9c;
}

.action {
  flex-shrink: 0;
  padding: 12rpx 28rpx;
  border: 1rpx solid #e54d42;
  border-radius: 8rpx;
  color: #e54d42;
  font-size: 26rpx;
}

.empty {
  padding: 120rpx 40rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
