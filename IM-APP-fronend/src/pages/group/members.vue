<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  fetchGroupDetail,
  fetchAllGroupMembers,
  muteGroupMember,
  removeGroupMember,
  unmuteGroupMember,
} from '@/api/group'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImNavBar from '@/components/ImNavBar.vue'
import { APP_CONFIG } from '@/config'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { MUTE_OPTIONS } from '@/constants/mute'
import { useUserStore } from '@/stores/user'
import type { GroupInfo, GroupMember, GroupMemberMuteResult } from '@/types'

useAuthGuard()

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
      fetchAllGroupMembers(groupId.value),
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

/** 群主/管理员名字用群昵称，备注放到身份括号里；普通成员仍优先展示备注 */
function displayName(member: GroupMember) {
  const role = (member.role || '').toLowerCase()
  if (role === 'owner' || role === 'admin') {
    return member.groupNickname || member.nickname || '成员'
  }
  return member.memberRemark?.trim() || member.groupNickname || member.nickname || '成员'
}

/** 群主/管理员徽章：有成员备注时在身份后括号展示，如 群主(产品负责人) */
function roleBadgeText(member: GroupMember) {
  const role = (member.role || '').toLowerCase()
  const base = role === 'owner' ? '群主' : role === 'admin' ? '管理员' : ''
  if (!base) return ''
  const remark = member.memberRemark?.trim()
  return remark ? `${base}(${remark})` : base
}

function memberAvatar(member: GroupMember) {
  if (member.id === myId.value) {
    return member.avatar || userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl
  }
  return member.avatar || APP_CONFIG.defaultAvatarUrl
}

/** 与后端权限矩阵一致：owner 可管 admin/member，admin 只可管 member；群主和自己不可操作 */
function canActOn(member: GroupMember) {
  if (!canManage.value) return false
  if (member.id === myId.value) return false
  if (member.role === 'owner') return false
  const role = group.value?.myRole
  if (role === 'owner') return true
  if (role === 'admin') return member.role === 'member'
  return false
}

function openProfile(member: GroupMember) {
  uni.navigateTo({
    url: `/pages/contacts/user-profile?id=${encodeURIComponent(member.id)}&groupId=${encodeURIComponent(groupId.value)}`,
  })
}

/** 禁言/解禁接口都会返回最新状态，就地更新列表避免整页重拉 */
function applyMuteResult(result: GroupMemberMuteResult) {
  members.value = members.value.map((m) =>
    m.id === result.memberUserId
      ? { ...m, isMuted: result.isMuted, mutedUntil: result.mutedUntil }
      : m,
  )
}

async function onMute(member: GroupMember) {
  if (busy.value || !canActOn(member)) return
  let tapIndex = -1
  try {
    const sheet = await uni.showActionSheet({ itemList: MUTE_OPTIONS.map((o) => o.label) })
    tapIndex = sheet.tapIndex
  } catch {
    return
  }
  const option = MUTE_OPTIONS[tapIndex]
  if (!option) return
  busy.value = true
  try {
    applyMuteResult(await muteGroupMember(groupId.value, member.id, option.seconds))
    uni.showToast({ title: '已禁言', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '禁言失败', icon: 'none' })
  } finally {
    busy.value = false
  }
}

async function onUnmute(member: GroupMember) {
  if (busy.value || !canActOn(member) || !member.isMuted) return
  busy.value = true
  try {
    applyMuteResult(await unmuteGroupMember(groupId.value, member.id))
    uni.showToast({ title: '已解禁', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '解禁失败', icon: 'none' })
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
    <ImNavBar title="群聊成员" @back="goBack">
      <template #right>
        <text class="action" :class="{ hidden: !canManage }" @click="goInvite">新增</text>
      </template>
    </ImNavBar>

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
        <view
          v-if="(member.role || '').toLowerCase() === 'owner'"
          class="badge badge-owner"
        >
          <text class="badge-text">{{ roleBadgeText(member) }}</text>
        </view>
        <view
          v-else-if="(member.role || '').toLowerCase() === 'admin'"
          class="badge badge-admin"
        >
          <text class="badge-text">{{ roleBadgeText(member) }}</text>
        </view>
        <view v-else-if="member.isMuted" class="badge badge-muted">
          <text class="badge-text">已禁言</text>
        </view>
        <view v-if="canActOn(member)" class="actions">
          <view class="btn-mute" @click.stop="onMute(member)">
            <text class="btn-text">禁言</text>
          </view>
          <view v-if="member.isMuted" class="btn-unmute" @click.stop="onUnmute(member)">
            <text class="btn-text">解禁</text>
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

.action {
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
  max-width: 280rpx;
  min-height: 48rpx;
  padding: 6rpx 18rpx;
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

.badge-muted {
  border: 2rpx solid #fbc02d;
}

.badge-muted .badge-text {
  color: #b8860b;
}

.badge-text {
  font-size: 24rpx;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.btn-unmute,
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

.btn-unmute {
  background: #4caf50;
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
