<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchGroups } from '@/api/contact'
import { useContactStore } from '@/stores/contact'
import { APP_CONFIG } from '@/config'
import type { GroupPreview } from '@/types'

const contactStore = useContactStore()
const tab = ref<'created' | 'joined'>('created')

const visibleGroups = computed(() => contactStore.groups)

async function loadGroups() {
  const role = tab.value === 'created' ? 'owner' : 'member'
  contactStore.groups = await fetchGroups(role)
}

onMounted(() => {
  void loadGroups()
})

/** 切回此页时刷新群列表，确保已解散群能立即消失 */
onShow(() => {
  void loadGroups()
})

watch(tab, () => {
  void loadGroups()
})

/** 与聊天列表保持一致：点群聊直接进会话，而不是先跳群资料页 */
function openGroup(g: GroupPreview) {
  if (g.status === 'dismissed') {
    uni.navigateTo({ url: `/pages/group/detail?id=${encodeURIComponent(g.id)}&dissolved=1` })
    return
  }
  contactStore.openChatWithGroup(g.id, g.name, g.avatar || APP_CONFIG.defaultGroupAvatarUrl)
}

function goCreate() {
  uni.navigateTo({ url: '/pages/group/create' })
}
</script>

<template>
  <view class="page">
    <view class="tabs">
      <view
        class="tab"
        :class="{ active: tab === 'created' }"
        @click="tab = 'created'"
      >我建立的</view>
      <view
        class="tab"
        :class="{ active: tab === 'joined' }"
        @click="tab = 'joined'"
      >我加入的</view>
    </view>

    <view
      v-for="g in visibleGroups"
      :key="g.id"
      class="row"
      @click="openGroup(g)"
    >
      <image
        class="avatar"
        :src="g.avatar || APP_CONFIG.defaultGroupAvatarUrl"
        mode="aspectFit"
      />
      <text class="name">{{ g.name }}</text>
      <text v-if="g.status === 'dismissed'" class="dissolved-tag">已解散</text>
      <text class="arrow">›</text>
    </view>

    <view v-if="!visibleGroups.length" class="empty">无群组</view>
    <view class="fab" @click="goCreate">＋</view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  position: relative;
}

.tabs {
  display: flex;
  border-bottom: 1rpx solid #f0f1f4;
  padding: 0 24rpx;
}

.tab {
  flex: 1;
  text-align: center;
  padding: 28rpx 0;
  font-size: 30rpx;
  color: #636e86;
  position: relative;
}

.tab.active {
  color: #212121;
  font-weight: 600;
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 20%;
  right: 20%;
  bottom: 0;
  height: 4rpx;
  background: #0a2fc2;
  border-radius: 4rpx;
}

.row {
  display: flex;
  align-items: center;
  padding: 24rpx 28rpx;
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
  color: #212121;
}

.dissolved-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #999;
  border: 1rpx solid #c9cdd4;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-left: 12rpx;
}

.arrow {
  color: #c8ccd6;
  font-size: 36rpx;
}

.empty {
  text-align: center;
  color: #8a8f9c;
  padding: 160rpx 40rpx;
  font-size: 28rpx;
}

.fab {
  display: none;
}
</style>
