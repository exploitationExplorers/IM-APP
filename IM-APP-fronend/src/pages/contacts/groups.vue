<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useContactStore } from '@/stores/contact'

const contactStore = useContactStore()
const tab = ref<'created' | 'joined'>('created')

const visibleGroups = computed(() => {
  // mock 暂无 created/joined 字段，先按当前列表展示；后续接后端再拆分
  return contactStore.groups
})

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
      @click="openGroup(g.id)"
    >
      <image class="avatar" :src="g.avatar || '/static/group-1.png'" mode="aspectFill" />
      <text class="name">{{ g.name }}</text>
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
