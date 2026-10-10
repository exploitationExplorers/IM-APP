<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  GROUP_MEMBERS_PAGE_SIZE,
  fetchGroupDetail,
  fetchGroupMembers,
  muteGroupMember,
  removeGroupMember,
  unmuteGroupMember,
} from '@/api/group'
import AppSearchBar from '@/components/AppSearchBar.vue'
import ImNavBar from '@/components/ImNavBar.vue'
import { APP_CONFIG } from '@/config'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { MUTE_OPTIONS } from '@/constants/mute'
import { useContactStore } from '@/stores/contact'
import { useUserStore } from '@/stores/user'
import type { GroupInfo, GroupMember, GroupMemberMuteResult } from '@/types'

useAuthGuard()

const userStore = useUserStore()
const contactStore = useContactStore()
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
    const displayName = `${friendRemark(member)} ${member.memberRemark || ''} ${member.groupNickname || ''} ${member.nickname || ''}`
    return displayName.toLowerCase().includes(text)
  })
})

// ---------------------------------------------------------------------------
// 滚动分页：一次只拉一页，滚到底再拉下一页。搜索是本地过滤，只能命中已加载的部分，
// 所以一旦开始搜索就把剩余页补齐，避免「成员明明在群里却搜不到」。
// ---------------------------------------------------------------------------

const loadingMore = ref(false)
const loadingAll = ref(false)
const hasMore = ref(false)
const nextCursor = ref('')
/** 后端返回数组（无分页能力）时视为一次给全 */
const paged = ref(true)
const loadedOnce = ref(false)
/** 从「新增成员」返回时要刷新，从成员资料返回时不要（否则丢失滚动位置） */
let refreshOnReturn = false

function appendMembers(list: GroupMember[]) {
  const seen = new Set(members.value.map((m) => m.id))
  const fresh = list.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
  if (fresh.length) members.value = [...members.value, ...fresh]
}

async function loadFirstPage() {
  loading.value = true
  try {
    const page = await fetchGroupMembers(groupId.value, { limit: GROUP_MEMBERS_PAGE_SIZE })
    if (Array.isArray(page)) {
      paged.value = false
      hasMore.value = false
      nextCursor.value = ''
      members.value = page
    } else {
      paged.value = true
      members.value = page.items
      hasMore.value = page.hasMore
      nextCursor.value = page.nextCursor || ''
    }
    loadedOnce.value = true
  } finally {
    loading.value = false
  }
}

/** 滚到底拉下一页；搜索补齐时也复用它 */
async function loadMorePage(): Promise<boolean> {
  if (!paged.value || !hasMore.value || loadingMore.value) return false
  loadingMore.value = true
  try {
    const before = members.value.length
    const page = await fetchGroupMembers(groupId.value, {
      cursor: nextCursor.value,
      limit: GROUP_MEMBERS_PAGE_SIZE,
    })
    if (Array.isArray(page)) {
      appendMembers(page)
      hasMore.value = false
      nextCursor.value = ''
      return false
    }
    appendMembers(page.items)
    hasMore.value = page.hasMore
    nextCursor.value = page.nextCursor || ''
    // 游标没前进 / 这一页全是重复成员时再翻下去也拿不到新数据，收尾避免死循环
    if (hasMore.value && (!nextCursor.value || members.value.length === before)) {
      hasMore.value = false
    }
    return hasMore.value
  } finally {
    loadingMore.value = false
  }
}

async function onReachBottom() {
  if (keyword.value.trim() || !hasMore.value) return
  try {
    await loadMorePage()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载更多失败', icon: 'none' })
  }
}

/** 搜索需要全量成员才能保证结果完整，这里把剩余页补齐 */
async function loadAllRemaining() {
  if (!paged.value || !hasMore.value || loadingAll.value) return
  loadingAll.value = true
  try {
    while (hasMore.value) {
      const more = await loadMorePage()
      if (!more) break
    }
  } catch {
    // 补齐失败就让搜索只覆盖已加载部分，不再打扰用户
  } finally {
    loadingAll.value = false
  }
}

watch(keyword, (value) => {
  if (value.trim()) void loadAllRemaining()
})

/** 未搜索时用群资料里的总人数，搜索时用命中数 */
const memberCountLabel = computed(() =>
  keyword.value.trim()
    ? filteredMembers.value.length
    : group.value?.memberCount || members.value.length,
)

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

onShow(async () => {
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  const needReload = !loadedOnce.value || refreshOnReturn
  if (!needReload) return
  refreshOnReturn = false
  try {
    await Promise.all([
      fetchGroupDetail(groupId.value).then((detail) => {
        group.value = detail
      }),
      loadFirstPage(),
    ])
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群成员失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

function goInvite() {
  if (!canManage.value) return
  // 邀请会改变成员列表，返回时刷新；看成员资料不会，所以不置位
  refreshOnReturn = true
  uni.navigateTo({
    url: `/pages/group/invite?id=${encodeURIComponent(groupId.value)}`,
  })
}

function friendRemark(member: GroupMember) {
  return contactStore.remarkOf(member.id)
}

/** 好友备注优先，和群聊里的名字保持一致 */
function displayName(member: GroupMember) {
  const remark = friendRemark(member)
  if (remark) return remark
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

async function openProfile(member: GroupMember) {
  if (member.id === myId.value) return
  if (!contactStore.contacts.length) {
    try {
      await contactStore.loadDirectory()
    } catch {
      /* 拉通讯录失败时按非好友打开资料 */
    }
  }
  const isFriend = contactStore.contacts.some((c) => c.id === member.id)
  if (isFriend) {
    await contactStore.openChatWithContact(
      member.id,
      displayName(member),
      member.avatar || APP_CONFIG.defaultAvatarUrl,
    )
    return
  }
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
      <text class="section-title">群成员 ({{ memberCountLabel }})</text>
    </view>

    <scroll-view scroll-y class="list" :lower-threshold="80" @scrolltolower="onReachBottom">
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
      <text v-if="loadingAll" class="loading">正在加载全部成员以便搜索...</text>
      <text v-else-if="loadingMore" class="loading">加载更多...</text>
      <text v-else-if="!loading && hasMore && !keyword.trim()" class="loading">上滑加载更多</text>
      <text v-if="!loading && !filteredMembers.length" class="empty">
        {{ keyword.trim() ? (loadingAll || hasMore ? '正在搜索全部成员...' : '未找到相关成员') : '暂无成员' }}
      </text>
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
  /* height: 0 让 flex 高度说了算，scroll-view 才会真正滚动、scrolltolower 才会触发 */
  height: 0;
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
