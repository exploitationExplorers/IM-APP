<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchGroups } from '@/api/contact'
import { useContactStore } from '@/stores/contact'
import { APP_CONFIG } from '@/config'
import type { GroupPreview } from '@/types'

const contactStore = useContactStore()
const tab = ref<'created' | 'joined'>('created')
const pageGroups = ref<GroupPreview[]>([])
const loading = ref(false)

const visibleGroups = computed(() => pageGroups.value.filter((g) => g.status !== 'dismissed'))

async function loadGroups() {
  loading.value = true
  try {
    const role = tab.value === 'created' ? 'owner' : 'member'
    pageGroups.value = await fetchGroups(role)
  } catch (e) {
    pageGroups.value = []
    uni.showToast({ title: (e as Error)?.message || '群列表加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

onShow(() => {
  void loadGroups()
})

watch(tab, () => {
  void loadGroups()
})

/** 与聊天列表保持一致：点群聊直接进会话，而不是先跳群资料页 */
function openGroup(g: GroupPreview) {
  if (g.status === 'dismissed') {
    uni.showToast({ title: '该群已解散', icon: 'none' })
    return
  }
  contactStore.openChatWithGroup(g.id, g.name, g.avatar || APP_CONFIG.defaultGroupAvatarUrl)
}

function roleTagOf(g: GroupPreview) {
  const role = (g.role || '').toLowerCase()
  if (role === 'owner') return '群主'
  if (role === 'admin') return '管理员'
  return ''
}

function roleTagClass(g: GroupPreview) {
  const role = (g.role || '').toLowerCase()
  return role === 'owner' ? 'role-owner' : 'role-admin'
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

    <view v-if="loading" class="empty">加载中…</view>
    <template v-else>
      <view
        v-for="g in visibleGroups"
        :key="g.id"
        class="row"
        @click="openGroup(g)"
      >
        <image
          class="avatar"
          :src="g.avatar || APP_CONFIG.defaultGroupAvatarUrl"
          mode="aspectFill"
        />
        <text class="name">{{ g.name || '群聊' }}</text>
        <text v-if="roleTagOf(g)" class="role-tag" :class="roleTagClass(g)">{{ roleTagOf(g) }}</text>
        <text v-if="g.status === 'dismissed'" class="dissolved-tag">已解散</text>
        <text class="arrow">›</text>
      </view>

      <view v-if="!visibleGroups.length" class="empty">无群组</view>
    </template>
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
  flex-shrink: 0;
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

.role-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
  margin-left: 12rpx;
  line-height: 1.4;
}

.role-owner {
  color: #636e86;
  border: 1rpx solid #c5cad6;
}

.role-admin {
  color: #0a2fc2;
  border: 1rpx solid #0a2fc2;
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
  flex-shrink: 0;
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
