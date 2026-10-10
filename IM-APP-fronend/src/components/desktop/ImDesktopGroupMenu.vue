<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import { useContactStore } from '@/stores/contact'
import { APP_CONFIG } from '@/config'
import { muteGroupMember, unmuteGroupMember } from '@/api/group'
import { MUTE_OPTIONS } from '@/constants/mute'
import type { GroupMember, GroupMemberMuteResult } from '@/types'

const props = defineProps<{
  modelValue: boolean
  groupId: string
  conversationId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  openFriend: [userId: string]
}>()

const groupStore = useGroupStore()
const userStore = useUserStore()
const contactStore = useContactStore()

const loading = ref(false)
const keyword = ref('')
const muteBusy = ref(false)

function sameUserId(a?: string, b?: string) {
  if (!a || !b) return false
  if (a === b) return true
  return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase()
}

function isOwnerRole(role?: string) {
  const r = (role || '').trim().toLowerCase()
  return r === 'owner' || r === '100'
}

function isAdminRole(role?: string) {
  const r = (role || '').trim().toLowerCase()
  return r === 'admin' || r === '60'
}

const groupDetail = computed(() => groupStore.currentGroup)
const memberList = computed(() => groupStore.members)

const myRole = computed(() => {
  const me = userStore.profile
  const self = me
    ? memberList.value.find((m) => sameUserId(m.id, me.id) || sameUserId(m.id, me.publicId))
    : undefined
  if (isOwnerRole(groupDetail.value?.myRole) || isOwnerRole(self?.role)) return 'owner'
  if (groupDetail.value?.myRole) return groupDetail.value.myRole
  return self?.role || 'member'
})

const isOwner = computed(() => {
  if (isOwnerRole(myRole.value)) return true
  const me = userStore.profile
  const ownerId = groupDetail.value?.ownerId
  if (me && (sameUserId(ownerId, me.id) || sameUserId(ownerId, me.publicId))) return true
  return !!me && memberList.value.some(
    (m) => isOwnerRole(m.role) && (sameUserId(m.id, me.id) || sameUserId(m.id, me.publicId)),
  )
})

const canManage = computed(() => isOwner.value || myRole.value === 'admin')
const groupName = computed(() => groupDetail.value?.name || '群聊')
const groupAvatar = computed(() => groupDetail.value?.avatar || APP_CONFIG.defaultGroupAvatarUrl)
const groupPublicId = computed(() => groupDetail.value?.id || props.groupId)
const memberCount = computed(
  () => memberList.value.length || groupDetail.value?.memberCount || 0,
)

const filteredMembers = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  const list = [...memberList.value].sort((a, b) => {
    const rank = (role?: string) => (isOwnerRole(role) ? 0 : isAdminRole(role) ? 1 : 2)
    const d = rank(a.role) - rank(b.role)
    if (d !== 0) return d
    return displayName(a).localeCompare(displayName(b), 'zh')
  })
  if (!text) return list
  return list.filter((m) => {
    const hay = `${m.memberRemark || ''} ${m.groupNickname || ''} ${m.nickname || ''}`.toLowerCase()
    return hay.includes(text)
  })
})

function close() {
  keyword.value = ''
  emit('update:modelValue', false)
}

async function loadMenuData() {
  if (!props.groupId) return
  loading.value = true
  try {
    if (!userStore.profile) await userStore.loadProfile()
    await groupStore.loadDetail(props.groupId)
    if (!contactStore.contacts.length) {
      await contactStore.loadDirectory().catch(() => undefined)
    }
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群信息失败', icon: 'none' })
    close()
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      keyword.value = ''
      void loadMenuData()
    }
  },
)

function displayName(member: GroupMember) {
  const remark = contactStore.remarkOf(member.id)
  if (remark) return remark
  const role = (member.role || '').toLowerCase()
  if (role === 'owner' || role === 'admin' || role === '100' || role === '60') {
    return member.groupNickname || member.nickname || '成员'
  }
  return member.memberRemark?.trim() || member.groupNickname || member.nickname || '成员'
}

function roleBadge(member: GroupMember) {
  if (isOwnerRole(member.role)) return '群主'
  if (isAdminRole(member.role)) return '管理员'
  return ''
}

function memberAvatar(member: GroupMember) {
  const me = userStore.profile
  if (me && sameUserId(member.id, me.id)) {
    return member.avatar || me.avatar || APP_CONFIG.defaultAvatarUrl
  }
  return member.avatar || APP_CONFIG.defaultAvatarUrl
}

const canEditGroupId = computed(
  () => isOwner.value && !groupDetail.value?.publicIdChangeUsed,
)

function copyGroupId() {
  const id = groupPublicId.value
  if (!id) return
  uni.setClipboardData({
    data: id,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}

function goEditGroupId() {
  if (!isOwner.value) {
    uni.showToast({ title: '仅群主可设置群号', icon: 'none' })
    return
  }
  if (groupDetail.value?.publicIdChangeUsed) {
    uni.showToast({ title: '群号只能修改一次', icon: 'none' })
    return
  }
  close()
  uni.navigateTo({
    url: `/pages/group/edit-group-id?id=${encodeURIComponent(groupPublicId.value)}`,
  })
}

function goFullDetail() {
  close()
  uni.navigateTo({
    url: `/pages/group/detail?id=${encodeURIComponent(props.groupId)}&code=group`,
  })
}

function goInvite() {
  if (!canManage.value) {
    uni.showToast({ title: '仅群主或管理员可邀请', icon: 'none' })
    return
  }
  close()
  uni.navigateTo({
    url: `/pages/group/invite?id=${encodeURIComponent(props.groupId)}`,
  })
}

function canMute(member: GroupMember) {
  const actorIsAdmin = isAdminRole(myRole.value)
  if (!isOwner.value && !actorIsAdmin) return false
  const me = userStore.profile
  if (me && (sameUserId(member.id, me.id) || sameUserId(member.id, me.publicId))) return false
  if (isOwnerRole(member.role)) return false
  if (isOwner.value) return true
  return !isAdminRole(member.role)
}

function applyMuteResult(result: GroupMemberMuteResult) {
  groupStore.members = groupStore.members.map((m) =>
    m.id === result.memberUserId
      ? { ...m, isMuted: result.isMuted, mutedUntil: result.mutedUntil }
      : m,
  )
}

async function onMute(member: GroupMember) {
  if (muteBusy.value || !canMute(member)) return
  if (member.isMuted) {
    muteBusy.value = true
    try {
      applyMuteResult(await unmuteGroupMember(props.groupId, member.id))
      uni.showToast({ title: '已解除禁言', icon: 'none' })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '解除禁言失败', icon: 'none' })
    } finally {
      muteBusy.value = false
    }
    return
  }
  let tapIndex = -1
  try {
    const sheet = await uni.showActionSheet({ itemList: MUTE_OPTIONS.map((o) => o.label) })
    tapIndex = sheet.tapIndex
  } catch {
    return
  }
  const option = MUTE_OPTIONS[tapIndex]
  if (!option) return
  muteBusy.value = true
  try {
    applyMuteResult(await muteGroupMember(props.groupId, member.id, option.seconds))
    uni.showToast({ title: `已禁言${option.label}`, icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '禁言失败', icon: 'none' })
  } finally {
    muteBusy.value = false
  }
}

async function openMember(member: GroupMember) {
  const me = userStore.profile
  if (me && sameUserId(member.id, me.id)) return
  close()
  if (!contactStore.contacts.length) {
    try {
      await contactStore.loadDirectory()
    } catch {
      /* ignore */
    }
  }
  const isFriend = contactStore.contacts.some((c) => sameUserId(c.id, member.id))
  if (isFriend) {
    // 好友直接开私聊，不必再点资料页「发消息」
    contactStore.openChatWithContactDesktop(
      member.id,
      displayName(member),
      member.avatar || APP_CONFIG.defaultAvatarUrl,
    )
    return
  }
  uni.navigateTo({
    url: `/pages/contacts/user-profile?id=${encodeURIComponent(member.id)}&groupId=${encodeURIComponent(props.groupId)}`,
  })
}

function goSearchHistory() {
  close()
  uni.navigateTo({
    url: `/pages/group/search-history?id=${encodeURIComponent(props.groupId)}&title=${encodeURIComponent(groupName.value)}`,
  })
}
</script>

<template>
  <view v-if="modelValue" class="group-info-layer">
    <view class="group-info-backdrop" @click="close" />

    <!-- 对齐参考站：400×min-h-80vh 左侧浮层 shadow-modal -->
    <view class="group-info-panel" @click.stop>
      <view v-if="loading" class="group-info-loading">加载中…</view>

      <template v-else>
        <view class="group-info-head" @click="goFullDetail">
          <image class="group-info-avatar" :src="groupAvatar" mode="aspectFill" />
          <view class="group-info-name-row">
            <text class="group-info-name">{{ groupName }}</text>
            <text class="group-info-chevron">›</text>
          </view>
        </view>

        <view class="group-info-id-row" @click="canEditGroupId ? goEditGroupId() : undefined">
          <text class="group-info-id-label">群号</text>
          <text class="group-info-id-value">{{ groupPublicId }}</text>
          <view class="group-info-copy" @click.stop="copyGroupId">
            <text>复制</text>
          </view>
          <text v-if="canEditGroupId" class="group-info-id-edit">设置</text>
          <text v-if="canEditGroupId" class="group-info-chevron">›</text>
        </view>

        <view class="group-info-search">
          <text class="group-info-search-icon">⌕</text>
          <input
            v-model="keyword"
            class="group-info-search-input"
            type="text"
            placeholder="搜索成员"
            confirm-type="search"
          />
        </view>

        <view class="group-info-history" @click="goSearchHistory">
          <text class="group-info-history-label">搜索聊天记录</text>
          <text class="group-info-chevron">›</text>
        </view>

        <view class="group-info-members-head">
          <text class="group-info-members-title">群成员 ({{ memberCount }})</text>
          <text v-if="canManage" class="group-info-add" @click="goInvite">新增</text>
        </view>

        <view class="group-info-members">
          <view
            v-for="m in filteredMembers"
            :key="m.id"
            class="group-info-member"
            @click="openMember(m)"
          >
            <image class="group-info-member-avatar" :src="memberAvatar(m)" mode="aspectFill" />
            <text class="group-info-member-name">{{ displayName(m) }}</text>
            <text v-if="roleBadge(m)" class="group-info-role">{{ roleBadge(m) }}</text>
            <text v-if="m.isMuted" class="group-info-role group-info-muted-tag">已禁言</text>
            <view v-if="canMute(m)" class="group-info-mute" @click.stop="onMute(m)">
              <text>{{ m.isMuted ? '解禁' : '禁言' }}</text>
            </view>
          </view>
          <view v-if="!filteredMembers.length" class="group-info-empty">
            {{ keyword.trim() ? '无匹配成员' : '暂无成员' }}
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 参考站 PC：min-w/max-w-100(400) + min-h-80vh + p-4 + rounded-2xl + shadow-modal */
.group-info-layer {
  position: absolute;
  inset: 0;
  z-index: 80;
}

.group-info-backdrop {
  position: absolute;
  inset: 0;
}

.group-info-panel {
  position: absolute;
  top: 8px;
  left: 8px;
  right: auto;
  width: 400px;
  max-width: calc(100% - 16px);
  height: min(80vh, calc(100% - 16px));
  max-height: calc(100% - 16px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 16px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.16);
  overflow: hidden;
}

.group-info-loading {
  padding: 28px 0;
  text-align: center;
  color: #8a8f9c;
  font-size: 14px;
}

.group-info-head {
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.group-info-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.group-info-name-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.group-info-name {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 24px;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-info-chevron {
  flex-shrink: 0;
  font-size: 22px;
  color: #b0b4bd;
  line-height: 1;
}

.group-info-id-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 0;
  box-sizing: border-box;
  flex-shrink: 0;
  cursor: pointer;
}

.group-info-id-label {
  flex-shrink: 0;
  font-size: 15px;
  color: #212121;
}

.group-info-id-value {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: #626e8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-info-copy {
  flex-shrink: 0;
  height: 32px;
  padding: 0 8px;
  border-radius: 4px;
  background: #3c83f6;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 32px;
  text-align: center;
  cursor: pointer;
}

.group-info-id-edit {
  flex-shrink: 0;
  margin-left: 6px;
  font-size: 13px;
  color: #3c83f6;
}

.group-info-search {
  margin-top: 4px;
  height: 36px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f3f4f7;
  border-radius: 4px;
  flex-shrink: 0;
}

.group-info-search-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: #9aa0a6;
}

.group-info-search-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  font-size: 14px;
  color: #212121;
}

.group-info-history {
  margin-top: 8px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  flex-shrink: 0;
}

.group-info-history-label {
  font-size: 14px;
  color: #212121;
}

.group-info-members-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0 8px;
  flex-shrink: 0;
}

.group-info-members-title {
  font-size: 14px;
  color: #8a8f9c;
}

.group-info-add {
  font-size: 14px;
  color: #0a2fc2;
  cursor: pointer;
}

.group-info-members {
  display: block;
  flex: 1;
  height: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
}

.group-info-members::-webkit-scrollbar {
  width: 6px;
}

.group-info-members::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.28);
  border-radius: 3px;
}

.group-info-member {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 8px 0;
  box-sizing: border-box;
  cursor: pointer;
  border-radius: 4px;
}

.group-info-member:hover {
  background: #f3f4f7;
}

.group-info-member-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f3f4f7;
  flex-shrink: 0;
}

.group-info-member-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-info-role {
  flex-shrink: 0;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid #d8dbe2;
  font-size: 12px;
  line-height: 18px;
  color: #555;
}

.group-info-muted-tag {
  color: #e54d42;
  border-color: #ffccc7;
  background: #fff1f0;
}

.group-info-mute {
  margin-left: auto;
  flex-shrink: 0;
  padding: 4px 12px;
  border-radius: 6px;
  background: #fff1f0;
  color: #e54d42;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}

.group-info-empty {
  padding: 24px 0;
  text-align: center;
  color: #8a8f9c;
  font-size: 13px;
}
</style>
