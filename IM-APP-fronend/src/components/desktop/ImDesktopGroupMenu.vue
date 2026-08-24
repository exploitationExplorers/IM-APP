<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ImSwitch from '@/components/ImSwitch.vue'
import { MessageReceiveOptType } from 'openim-uniapp-polyfill'
import { useGroupStore } from '@/stores/group'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { clearConversationHistory } from '@/api/im'
import { fetchJoinRequests } from '@/api/group'
import {
  setConversationPin,
  setConversationRecvOpt,
} from '@/utils/openim'
import type { GroupJoinMode } from '@/types'

const props = defineProps<{
  modelValue: boolean
  groupId: string
  conversationId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const groupStore = useGroupStore()
const chatStore = useChatStore()
const userStore = useUserStore()

const loading = ref(false)
const pendingJoinCount = ref(0)
const recvOpt = ref<number>(MessageReceiveOptType.Normal)
const pinned = ref(false)
const showJoinModePicker = ref(false)

function sameUserId(a?: string, b?: string) {
  if (!a || !b) return false
  if (a === b) return true
  return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase()
}

function isOwnerRole(role?: string) {
  const r = (role || '').trim().toLowerCase()
  return r === 'owner' || r === '100'
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
const joinModeLabel = computed(() =>
  groupDetail.value?.joinMode === 'approval' ? '私密群（申请入群）' : '公开群（扫码入群）',
)

function close() {
  showJoinModePicker.value = false
  emit('update:modelValue', false)
}

async function loadMenuData() {
  if (!props.groupId) return
  loading.value = true
  try {
    if (!userStore.profile) await userStore.loadProfile()
    await groupStore.loadDetail(props.groupId)
    await initConversationSettings()
    await loadPendingJoinCount()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群信息失败', icon: 'none' })
    close()
  } finally {
    loading.value = false
  }
}

async function loadPendingJoinCount() {
  if (!canManage.value) {
    pendingJoinCount.value = 0
    return
  }
  try {
    const list = await fetchJoinRequests(props.groupId)
    pendingJoinCount.value = list.length
  } catch {
    pendingJoinCount.value = 0
  }
}

async function initConversationSettings() {
  const cached = chatStore.conversations.find((c) => c.id === props.conversationId)
  recvOpt.value = cached?.recvMsgOpt ?? MessageReceiveOptType.Normal
  pinned.value = cached?.pinned ?? false
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      showJoinModePicker.value = false
      void loadMenuData()
    }
  },
)

function nav(url: string) {
  close()
  uni.navigateTo({ url })
}

function goToAdmin() {
  nav(`/pages/group/admin?id=${encodeURIComponent(props.groupId)}`)
}

function goToJoinRequests() {
  nav(`/pages/group/join-requests?id=${encodeURIComponent(props.groupId)}`)
}

function goToAnnouncement() {
  nav(`/pages/group/announcement?id=${encodeURIComponent(props.groupId)}`)
}

function goToGroupQrcode() {
  nav(`/pages/group/qrcode?id=${encodeURIComponent(props.groupId)}`)
}

function goToMyNickname() {
  nav(`/pages/group/my-nickname?id=${encodeURIComponent(props.groupId)}`)
}

function goToMedia() {
  nav(`/pages/group/media?id=${encodeURIComponent(props.groupId)}`)
}

function goToSearchHistory() {
  nav(`/pages/group/search-history?id=${encodeURIComponent(props.groupId)}`)
}

function goToReport() {
  nav(`/pages/group/report?id=${encodeURIComponent(props.groupId)}`)
}

async function onToggleRecv(v: boolean) {
  if (!props.conversationId) {
    uni.showToast({ title: '会话未就绪', icon: 'none' })
    return
  }
  const opt = v ? MessageReceiveOptType.NotNotify : MessageReceiveOptType.Normal
  try {
    await setConversationRecvOpt(props.conversationId, opt)
    recvOpt.value = opt
    chatStore.patchConversation(props.conversationId, { recvMsgOpt: opt })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function onTogglePin(v: boolean) {
  if (!props.conversationId) {
    uni.showToast({ title: '会话未就绪', icon: 'none' })
    return
  }
  try {
    await setConversationPin(props.conversationId, v)
    pinned.value = v
    chatStore.patchConversation(props.conversationId, { pinned: v })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function selectJoinMode(mode: GroupJoinMode) {
  showJoinModePicker.value = false
  if (groupDetail.value?.joinMode === mode) return
  try {
    await groupStore.updateSettings(props.groupId, { joinMode: mode })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function onClearHistory() {
  const res = await uni.showModal({
    title: '清除聊天记录',
    content: '聊天记录将从你的所有设备中删除，不会影响其他群成员',
    confirmText: '确认',
    cancelText: '取消',
  })
  if (!res.confirm) return
  try {
    try {
      await clearConversationHistory('group', props.groupId)
    } catch (e) {
      console.warn('服务端清除聊天记录失败，仅清除本端', e)
    }
    await chatStore.clearHistory(props.conversationId)
    uni.showToast({ title: '已清除', icon: 'success' })
    close()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '清除失败', icon: 'none' })
  }
}
</script>

<template>
  <view v-if="modelValue" class="group-menu-layer">
    <view class="group-menu-backdrop" @click="close" />

    <view class="group-menu-panel" @click.stop>
      <view v-if="loading" class="group-menu-loading">加载中…</view>

      <template v-else>
        <view v-if="canManage" class="group-menu-section">
          <view class="group-menu-item" @click="goToAdmin">
            <text class="group-menu-label">群组管理</text>
          </view>
          <view class="group-menu-item" @click="goToJoinRequests">
            <text class="group-menu-label">入群申请</text>
            <text v-if="pendingJoinCount" class="group-menu-meta">{{ pendingJoinCount }}</text>
          </view>
          <view class="group-menu-item" @click="showJoinModePicker = !showJoinModePicker">
            <text class="group-menu-label">入群方式</text>
            <text class="group-menu-meta">{{ joinModeLabel }}</text>
          </view>
          <view v-if="showJoinModePicker" class="group-menu-sub">
            <view class="group-menu-sub-item" @click="selectJoinMode('open')">公开群（扫码入群）</view>
            <view class="group-menu-sub-item" @click="selectJoinMode('approval')">私密群（申请入群）</view>
          </view>
        </view>

        <view class="group-menu-section">
          <view class="group-menu-item" @click="goToAnnouncement">
            <text class="group-menu-label">群公告</text>
          </view>
          <view class="group-menu-item" @click="goToGroupQrcode">
            <text class="group-menu-label">群二维码</text>
          </view>
          <view class="group-menu-item" @click="goToMyNickname">
            <text class="group-menu-label">我在本群的昵称</text>
          </view>
        </view>

        <view class="group-menu-section">
          <view class="group-menu-item" @click="goToMedia">
            <text class="group-menu-label">图片与视频</text>
          </view>
          <view class="group-menu-item" @click="goToSearchHistory">
            <text class="group-menu-label">搜索聊天记录</text>
          </view>
          <view class="group-menu-item" @click="onClearHistory">
            <text class="group-menu-label">清除聊天记录</text>
          </view>
        </view>

        <view class="group-menu-section">
          <view class="group-menu-item group-menu-switch-row">
            <text class="group-menu-label">消息免打扰</text>
            <ImSwitch
              :model-value="recvOpt === MessageReceiveOptType.NotNotify"
              @change="onToggleRecv"
            />
          </view>
          <view class="group-menu-item group-menu-switch-row">
            <text class="group-menu-label">置顶聊天</text>
            <ImSwitch :model-value="pinned" @change="onTogglePin" />
          </view>
        </view>

        <view class="group-menu-section group-menu-section-last">
          <view class="group-menu-item" @click="goToReport">
            <text class="group-menu-label">检举</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped lang="scss">
.group-menu-layer {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 80;
}

.group-menu-backdrop {
  position: fixed;
  inset: 0;
}

.group-menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 280px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.08);
}

.group-menu-loading {
  padding: 20px 16px;
  text-align: center;
  color: #8a8f9c;
  font-size: 14px;
}

.group-menu-section {
  border-bottom: 1px solid #ececec;
}

.group-menu-section-last {
  border-bottom: none;
}

.group-menu-item {
  min-height: 44px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.group-menu-item:active {
  background: #f5f6f8;
}

.group-menu-label {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 20px;
  color: #212121;
}

.group-menu-meta {
  flex-shrink: 0;
  max-width: 140px;
  font-size: 12px;
  line-height: 18px;
  color: #8a8f9c;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-menu-switch-row {
  cursor: default;
}

.group-menu-switch-row:active {
  background: transparent;
}

.group-menu-sub {
  background: #f8f9fb;
  border-top: 1px solid #ececec;
}

.group-menu-sub-item {
  min-height: 40px;
  padding: 0 16px 0 28px;
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #212121;
  cursor: pointer;
}

.group-menu-sub-item:active {
  background: #eef0f4;
}
</style>
