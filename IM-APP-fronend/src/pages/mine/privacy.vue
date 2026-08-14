<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchPrivacySettings, updatePrivacySettings } from '@/api/user'
import type { PrivacySettings } from '@/types'

/** 对齐参考站：加好友默认无需验证 */
const friendVerify = ref(false)
const groupInviteVerify = ref(true)
const saving = ref(false)

onMounted(async () => {
  try {
    const s = await fetchPrivacySettings()
    friendVerify.value = s.requireFriendApproval
    groupInviteVerify.value = s.requireGroupApproval
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  }
})

async function persist(next: PrivacySettings, rollback: () => void) {
  if (saving.value) return
  saving.value = true
  try {
    const s = await updatePrivacySettings(next)
    friendVerify.value = s.requireFriendApproval
    groupInviteVerify.value = s.requireGroupApproval
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    rollback()
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function onFriendVerify(e: Event) {
  const newValue = (e as unknown as { detail: { value: boolean } }).detail.value
  const prev = friendVerify.value
  friendVerify.value = newValue
  void persist(
    {
      requireFriendApproval: newValue,
      requireGroupApproval: groupInviteVerify.value,
    },
    () => {
      friendVerify.value = prev
    },
  )
}

function onGroupInviteVerify(e: Event) {
  const newValue = (e as unknown as { detail: { value: boolean } }).detail.value
  const prev = groupInviteVerify.value
  groupInviteVerify.value = newValue
  void persist(
    {
      requireFriendApproval: friendVerify.value,
      requireGroupApproval: newValue,
    },
    () => {
      groupInviteVerify.value = prev
    },
  )
}

function goBlacklist() {
  uni.navigateTo({
    url: '/pages/mine/blacklist',
  })
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">加我为好友需验证</text>
      <switch :checked="friendVerify" color="#0A2FC2" @change="onFriendVerify" style="transform:scale(0.8)" />
    </view>
    <view class="cell">
      <text class="label">邀请我加入群聊需验证</text>
      <switch :checked="groupInviteVerify" color="#0A2FC2" @change="onGroupInviteVerify" style="transform:scale(0.8)" />
    </view>
    <view class="cell" @click="goBlacklist">
      <text class="label">黑名单</text>
      <text class="arrow">›</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  min-height: 96rpx;
  box-sizing: border-box;
}

.label {
  font-size: 30rpx;
  color: #212121;
}

.arrow {
  color: #c8ccd6;
  font-size: 32rpx;
}
</style>
