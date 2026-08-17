<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import ImSwitch from '@/components/ImSwitch.vue'
import { useGroupStore } from '@/stores/group'

const groupStore = useGroupStore()
const groupId = ref('')

const detail = computed(() => groupStore.currentGroup)
const forbidAddFriend = computed(() => !(detail.value?.allowMemberAddFriend ?? true))
const allMuted = computed(() => !!detail.value?.allMuted)

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

onShow(async () => {
  if (!groupId.value) return
  try {
    await groupStore.loadDetail(groupId.value)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

function goToAdmins() {
  uni.navigateTo({
    url: `/pages/group/admins?id=${encodeURIComponent(groupId.value)}`,
  })
}

async function onToggleForbidAdd(v: boolean) {
  try {
    await groupStore.updateSettings(groupId.value, { allowMemberAddFriend: !v })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function onToggleMute(v: boolean) {
  try {
    await groupStore.updateSettings(groupId.value, { allMuted: v })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">群组管理</text>
      <view class="nav-space" />
    </view>

    <view class="card">
      <view class="row" @click="goToAdmins">
        <text class="label">群组管理员</text>
        <text class="arrow">›</text>
      </view>
      <view class="row">
        <text class="label">禁止群成员互加好友</text>
        <ImSwitch :model-value="forbidAddFriend" @change="onToggleForbidAdd" />
      </view>
      <view class="row last">
        <text class="label">全员禁言</text>
        <ImSwitch :model-value="allMuted" @change="onToggleMute" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
}

.nav {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 26rpx;
  background: #fff;
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

.card {
  margin-top: 16rpx;
  background: #fff;
}

.row {
  min-height: 96rpx;
  padding: 0 30rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1rpx solid #f0f0f0;
}

.last {
  border-bottom: none;
}

.label {
  font-size: 30rpx;
  color: #1d1d1d;
}

.arrow {
  font-size: 40rpx;
  color: #999;
}
</style>
