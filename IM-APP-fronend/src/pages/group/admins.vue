<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { useGroupStore } from '@/stores/group'
import type { GroupMember } from '@/types'

const groupStore = useGroupStore()
const groupId = ref('')

const managers = computed(() =>
  groupStore.members.filter((m) => m.role === 'owner' || m.role === 'admin'),
)
const isOwner = computed(() => groupStore.currentGroup?.myRole === 'owner')

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

function goAdd() {
  if (!isOwner.value) return
  uni.navigateTo({
    url: `/pages/group/admin-add?id=${encodeURIComponent(groupId.value)}`,
  })
}

function displayName(member: GroupMember) {
  return member.memberRemark || member.groupNickname || member.nickname || '成员'
}

function roleLabel(member: GroupMember) {
  return member.role === 'owner' ? '群主' : '管理员'
}

async function onTapMember(member: GroupMember) {
  if (!isOwner.value || member.role !== 'admin') return
  const res = await uni.showModal({
    title: '取消管理员',
    content: `确定取消「${displayName(member)}」的管理员身份吗？`,
    confirmText: '确定',
    cancelText: '取消',
  })
  if (!res.confirm) return
  try {
    await groupStore.setMemberRole(groupId.value, member.id, 'member')
    uni.showToast({ title: '已取消', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '操作失败', icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">群组管理员</text>
      <text class="nav-action" :class="{ hidden: !isOwner }" @click="goAdd">新增</text>
    </view>

    <view class="list">
      <view
        v-for="member in managers"
        :key="member.id"
        class="row"
        @click="onTapMember(member)"
      >
        <image class="avatar" :src="member.avatar" mode="aspectFill" />
        <view class="meta">
          <text class="name">{{ displayName(member) }}</text>
          <text class="role">{{ roleLabel(member) }}</text>
        </view>
      </view>
    </view>

    <text class="hint">
      群管理员可以拥有以下能力：批准入群申请、禁言/解禁用户、删除群成员、编辑群公告、修改群组名称和群头像
    </text>
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
  background: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.nav-back {
  width: 72rpx;
  height: 72rpx;
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

.nav-action {
  min-width: 72rpx;
  text-align: right;
  font-size: 28rpx;
  color: #0a2fc2;
}

.hidden {
  visibility: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 20rpx 32rpx;
}

.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #eee;
}

.meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.name {
  font-size: 30rpx;
  color: #1d1d1d;
}

.role {
  font-size: 24rpx;
  color: #8a8f9c;
}

.hint {
  display: block;
  padding: 24rpx 32rpx 48rpx;
  font-size: 24rpx;
  color: #8a8f9c;
  line-height: 1.7;
}
</style>
