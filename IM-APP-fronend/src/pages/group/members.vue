<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  fetchGroupDetail,
  fetchGroupMembers,
  muteGroupMember,
  removeGroupMember,
} from '@/api/group'
import AppSearchBar from '@/components/AppSearchBar.vue'
import { APP_CONFIG } from '@/config'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useUserStore } from '@/stores/user'
import type { GroupInfo, GroupMember } from '@/types'
import { getStatusBarHeight } from '@/utils/status-bar'

useAuthGuard()

const MUTE_LABELS = ['10分钟', '1小时', '12小时', '1天', '7天']
const MUTE_SECONDS = [10 * 60, 60 * 60, 12 * 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60]

const statusBarHeight = getStatusBarHeight()
const userStore = useUserStore()
const groupId = ref('')
const keyword = ref('')
const members = ref<GroupMember[]>([])
const group = ref<GroupInfo | null>(null)
const loading = ref(false)
const busy = ref(false)

const myId = computed(() => userStore.profile?.id || '')
const canManage = computed(
  () => group.value?.permissions?.canManageMembers ?? (group.value?.myRole === 'owner' || group.value?.myRole === 'admin'),
)

const filteredMembers = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return members.value
  return members.value.filter((member) => {
    const displayName = `${member.memberRemark || ''} ${member.groupNickname || ''} ${member.nickname || ''}`
    return displayName.toLowerCase().includes(text)
  })
})

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

onShow(async () => {
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  loading.value = true
  try {
    const [detail, list] = await Promise.all([
      fetchGroupDetail(groupId.value),
      fetchGroupMembers(groupId.value),
    ])
    group.value = detail
    members.value = list
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群成员失败', icon: 'none' })
  } finally {
    loading.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

function goInvite() {
  if (!canManage.value) return
  uni.navigateTo({
    url: `/pages/group/invite?id=${encodeURIComponent(groupId.value)}`,
  })
}

function displayName(member: GroupMember) {
  return member.memberRemark?.trim() || member.groupNickname || member.nickname || '成员'
}

function memberAvatar(member: GroupMember) {
  if (member.id === myId.value) {
    return member.avatar || userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl
  }
  return member.avatar || APP_CONFIG.defaultAvatarUrl
}

function canActOn(member: GroupMember) {
  if (!canManage.value) return false
  if (member.id === myId.value) return false
  return member.role === 'member'
}

function openProfile(member: GroupMember) {
  uni.navigateTo({
    url: `/pages/contacts/user-profile?id=${encodeURIComponent(member.id)}`,
  })
}

async function onMute(member: GroupMember) {
  if (busy.value || !canActOn(member)) return
  let tapIndex = -1
  try {
    const sheet = await uni.showActionSheet({ itemList: MUTE_LABELS })
    tapIndex = sheet.tapIndex
  } catch {
    return
  }
  if (tapIndex < 0 || tapIndex >= MUTE_SECONDS.length) return
  busy.value = true
  try {
    await muteGroupMember(groupId.value, member.id, MUTE_SECONDS[tapIndex])
    uni.showToast({ title: '已禁言', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '禁言失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}

async function onRemove(member: GroupMember) {
  if (busy.value || !canActOn(member)) return
  const res = await uni.showModal({
    title: '移除成员',
    content: `确定将 ${displayName(member)} 移出群聊？`,
    confirmText: '移除',
    cancelText: '取消',
  })
  if (!res.confirm) return
  busy.value = true
  try {
    await removeGroupMember(groupId.value, member.id)
    members.value = members.value.filter((item) => item.id !== member.id)
    uni.showToast({ title: '已移除', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '移除失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">群聊成员</text>
      <text class="action" :class="{ hidden: !canManage }" @click="goInvite">新增</text>
    </view>

    <AppSearchBar v-model="keyword" placeholder="搜索" />

    <view class="section-head">
      <text class="section-title">群成员 ({{ filteredMembers.length }})</text>
    </view>

    <scroll-view scroll-y class="list">
      <text v-if="loading" class="loading">加载中...</text>
      <view
        v-for="member in filteredMembers"
        :key="member.id"
        class="member-row"
        @click="openProfile(member)"
      >
        <image class="avatar" :src="memberAvatar(member)" mode="aspectFill" />
        <text class="name">{{ displayName(member) }}</text>
        <view v-if="member.role === 'owner'" class="badge badge-owner">
          <text class="badge-text">群主</text>
        </view>
        <view v-else-if="member.role === 'admin'" class="badge badge-admin">
          <text class="badge-text">管理员</text>
        </view>
        <view v-else-if="canActOn(member)" class="actions">
          <view class="btn-mute" @click.stop="onMute(member)">
            <text class="btn-text">禁言</text>
          </view>
          <view class="btn-remove" @click.stop="onRemove(member)">
            <text class="btn-text">移除</text>
          </view>
        </view>
      </view>
      <text v-if="!loading && !filteredMembers.length" class="empty">暂无成员</text>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 40rpx;
  box-sizing: content-box;
  background: #fff;
}

.back-btn {
  font-size: 56rpx;
  color: #212121;
  width: 88rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #212121;
}

.action {
  width: 88rpx;
  text-align: right;
  font-size: 30rpx;
  color: #212121;
}

.action.hidden {
  opacity: 0;
  pointer-events: none;
}

.section-head {
  padding: 8rpx 40rpx 12rpx;
}

.section-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #212121;
}

.list {
  flex: 1;
  padding: 0 0 28rpx;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 32rpx;
  padding: 16rpx 40rpx;
  box-sizing: border-box;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 32rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  min-width: 128rpx;
  height: 48rpx;
  padding: 0 22rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
}

.badge-owner {
  border: 2rpx solid #c5cad6;
}

.badge-admin {
  border: 2rpx solid $uni-color-primary;
}

.badge-text {
  font-size: 24rpx;
  line-height: 1;
}

.badge-owner .badge-text {
  color: #636e86;
}

.badge-admin .badge-text {
  color: $uni-color-primary;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex-shrink: 0;
}

.btn-mute,
.btn-remove {
  height: 64rpx;
  min-width: 104rpx;
  padding: 0 20rpx;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.btn-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
  line-height: 1;
}

.btn-mute {
  background: #fbc02d;
}

.btn-remove {
  background: #dc2828;
}

.empty,
.loading {
  display: block;
  padding: 120rpx 20rpx;
  text-align: center;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
