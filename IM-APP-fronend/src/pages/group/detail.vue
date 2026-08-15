<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImSwitch from '@/components/ImSwitch.vue'
import { MessageReceiveOptType } from 'openim-uniapp-polyfill'
import { useGroupStore } from '@/stores/group'
import { useChatStore } from '@/stores/chat'
import {
  setConversationPin,
  setConversationRecvOpt,
  resolveGroupConversationID,
} from '@/utils/openim'
import { safeBack } from '@/utils/nav'
import { APP_CONFIG } from '@/config'
import { uploadAvatarForProfile } from '@/utils/file-upload'
import type { GroupJoinMode } from '@/types'

const PREVIEW_MEMBER_LIMIT = 6

const groupStore = useGroupStore()
const chatStore = useChatStore()
const groupId = ref('')
const showJoinMode = ref(false)

const groupDetail = computed(() => groupStore.currentGroup)
const memberList = computed(() => groupStore.members)
const previewMembers = computed(() => memberList.value.slice(0, PREVIEW_MEMBER_LIMIT))
const groupName = computed(() => groupDetail.value?.remark?.trim() || groupDetail.value?.name || '群聊')
const avatar = computed(() => groupDetail.value?.avatar || APP_CONFIG.defaultGroupAvatarUrl)
const memberCount = computed(() => groupDetail.value?.memberCount ?? memberList.value.length)
const myRole = computed(() => groupDetail.value?.myRole || 'member')
const isOwner = computed(() => myRole.value === 'owner')
const canManage = computed(() => myRole.value === 'owner' || myRole.value === 'admin')
const canEditProfile = computed(
  () => groupDetail.value?.permissions?.canEditProfile ?? canManage.value,
)
const joinModeLabel = computed(() =>
  groupDetail.value?.joinMode === 'approval' ? '私密群（申请入群）' : '公开群（扫码入群）',
)

const convId = ref('')
const recvOpt = ref<number>(MessageReceiveOptType.Normal)
const pinned = ref(false)

function getMemberDisplayName(member: { nickname?: string; groupNickname?: string }) {
  return member.groupNickname || member.nickname || '成员'
}

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) {
    uni.showToast({ title: '缺少群聊 ID', icon: 'none' })
    return
  }
  try {
    await groupStore.loadDetail(groupId.value)
    await initConversationSettings()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载群聊详情失败', icon: 'none' })
  }
})

async function initConversationSettings() {
  try {
    convId.value = await resolveGroupConversationID(groupId.value)
    const cached = chatStore.conversations.find((c) => c.id === convId.value)
    recvOpt.value = cached?.recvMsgOpt ?? MessageReceiveOptType.Normal
    pinned.value = cached?.pinned ?? false
  } catch {
    // 拿不到会话 ID 时开关保持默认，不影响其它功能
  }
}

async function onToggleRecv(v: boolean) {
  if (!convId.value) {
    uni.showToast({ title: '会话未就绪', icon: 'none' })
    return
  }
  const opt = v ? MessageReceiveOptType.NotNotify : MessageReceiveOptType.Normal
  try {
    await setConversationRecvOpt(convId.value, opt)
    recvOpt.value = opt
    chatStore.patchConversation(convId.value, { recvMsgOpt: opt })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function onTogglePin(v: boolean) {
  if (!convId.value) {
    uni.showToast({ title: '会话未就绪', icon: 'none' })
    return
  }
  try {
    await setConversationPin(convId.value, v)
    pinned.value = v
    chatStore.patchConversation(convId.value, { pinned: v })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

function goBack() {
  safeBack('/pages/chat/index')
}

function goToMembers() {
  uni.navigateTo({
    url: `/pages/group/members?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToAdmin() {
  uni.navigateTo({
    url: `/pages/group/admin?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToJoinRequests() {
  uni.navigateTo({
    url: `/pages/group/join-requests?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToEditName() {
  if (!canEditProfile.value) return
  uni.navigateTo({
    url: `/pages/group/edit-name?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToAnnouncement() {
  uni.navigateTo({
    url: `/pages/group/announcement?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToGroupQrcode() {
  uni.navigateTo({
    url: `/pages/group/qrcode?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToMyNickname() {
  uni.navigateTo({
    url: `/pages/group/my-nickname?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToRemark() {
  uni.navigateTo({
    url: `/pages/group/remark?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToMedia() {
  uni.navigateTo({
    url: `/pages/group/media?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToSearchHistory() {
  uni.navigateTo({
    url: `/pages/group/search-history?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToReport() {
  uni.navigateTo({
    url: `/pages/group/report?id=${encodeURIComponent(groupId.value)}`,
  })
}

function copyGroupId() {
  uni.setClipboardData({
    data: groupId.value,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}

async function onChooseAvatar() {
  if (!canEditProfile.value) return
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const paths = res.tempFilePaths
      const path = Array.isArray(paths) ? paths[0] : paths
      if (!path) return
      uni.showLoading({ title: '上传中…', mask: true })
      try {
        const fileId = await uploadAvatarForProfile(path, undefined)
        await groupStore.updateSettings(groupId.value, { avatarFileId: fileId })
        await groupStore.loadDetail(groupId.value)
        uni.showToast({ title: '已更新', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: (e as Error)?.message || '上传失败', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },
  })
}

async function selectJoinMode(mode: GroupJoinMode) {
  showJoinMode.value = false
  if (groupDetail.value?.joinMode === mode) return
  try {
    await groupStore.updateSettings(groupId.value, { joinMode: mode })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '设置失败', icon: 'none' })
  }
}

async function onClearHistory() {
  const res = await uni.showModal({
    title: '清除聊天记录',
    content: '聊天记录只会从此设备中删除，不会从其他人的设备中删除',
    confirmText: '确认',
    cancelText: '取消',
  })
  if (!res.confirm) return
  try {
    const conversationId = convId.value || (await resolveGroupConversationID(groupId.value))
    convId.value = conversationId
    await chatStore.clearHistory(conversationId)
    uni.showToast({ title: '已清除', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '清除失败', icon: 'none' })
  }
}

async function onLeaveOrDismiss() {
  if (isOwner.value) {
    const res = await uni.showModal({
      title: '解散群',
      content: '解散后群聊将不可恢复，确定继续吗？',
      confirmText: '确定',
      cancelText: '取消',
    })
    if (!res.confirm) return
    try {
      await groupStore.dismiss(groupId.value)
      uni.reLaunch({ url: '/pages/chat/index' })
    } catch (e) {
      uni.showToast({ title: (e as Error)?.message || '解散失败', icon: 'none' })
    }
    return
  }
  const res = await uni.showModal({
    title: '退出群聊',
    content: '退出后将删除本群对话，确定继续吗？',
    confirmText: '确定',
    cancelText: '取消',
  })
  if (!res.confirm) return
  try {
    await groupStore.leave(groupId.value)
    uni.reLaunch({ url: '/pages/chat/index' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '退出失败', icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">群组详情</text>
      <view class="header-spacer" />
    </view>

    <view class="card">
      <view class="member-row" @click="goToMembers">
        <view v-for="member in previewMembers" :key="member.id" class="member-item">
          <image class="member-avatar" :src="member.avatar" mode="aspectFill" />
          <text class="member-name">{{ getMemberDisplayName(member) }}</text>
        </view>
        <view v-if="memberList.length" class="add-member" @click.stop="goToMembers">
          <view class="add-circle">＋</view>
        </view>
      </view>
      <view class="group-row" @click="goToMembers">
        <text class="label">群组成员</text>
        <view class="row-right">
          <text class="muted">共{{ memberCount }}人</text>
          <text class="arrow">›</text>
        </view>
      </view>
    </view>

    <view v-if="canManage" class="card">
      <view class="info-row nav-row" @click="goToAdmin">
        <text class="label">群组管理</text>
        <text class="arrow">›</text>
      </view>
      <view class="info-row nav-row" @click="goToJoinRequests">
        <text class="label">入群申请</text>
        <text class="arrow">›</text>
      </view>
      <view class="info-row nav-row" @click="showJoinMode = true">
        <text class="label">入群方式</text>
        <view class="row-right">
          <text class="muted">{{ joinModeLabel }}</text>
          <text class="arrow">›</text>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="info-row" :class="{ 'nav-row': canEditProfile }" @click="goToEditName">
        <text class="label">群组名称</text>
        <view class="row-right">
          <text class="value">{{ groupDetail?.name || groupName }}</text>
          <text v-if="canEditProfile" class="arrow">›</text>
        </view>
      </view>

      <view class="info-row" :class="{ 'nav-row': canEditProfile }" @click="onChooseAvatar">
        <text class="label">群头像</text>
        <view class="row-right">
          <view class="avatar-box">
            <image class="current-avatar" :src="avatar" mode="aspectFill" />
          </view>
          <text v-if="canEditProfile" class="arrow">›</text>
        </view>
      </view>

      <view class="info-row info-row-id">
        <text class="label">群聊ID</text>
        <view class="id-box">
          <text class="value id-value">{{ groupId }}</text>
          <view class="copy-btn" @click="copyGroupId">复制</view>
        </view>
      </view>

      <view class="info-row nav-row" @click="goToAnnouncement">
        <text class="label">群公告</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row" @click="goToGroupQrcode">
        <text class="label">群二维码</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row" @click="goToRemark">
        <text class="label">群备注</text>
        <view class="row-right">
          <text class="muted">{{ groupDetail?.remark?.trim() || '未设置' }}</text>
          <text class="arrow">›</text>
        </view>
      </view>

      <view class="info-row nav-row last" @click="goToMyNickname">
        <text class="label">我在本群的昵称</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="card">
      <view class="info-row nav-row" @click="goToMedia">
        <text class="label">图片与视频</text>
        <text class="arrow">›</text>
      </view>
      <view class="info-row nav-row" @click="goToSearchHistory">
        <text class="label">搜索聊天记录</text>
        <text class="arrow">›</text>
      </view>
      <view class="info-row nav-row last" @click="onClearHistory">
        <text class="label">清除聊天记录</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="card">
      <view class="switch-row">
        <text class="label">消息免打扰</text>
        <ImSwitch :model-value="recvOpt === MessageReceiveOptType.NotNotify" @change="onToggleRecv" />
      </view>
      <view class="switch-row last">
        <text class="label">置顶聊天</text>
        <ImSwitch :model-value="pinned" @change="onTogglePin" />
      </view>
    </view>

    <view class="card">
      <view class="action-row" @click="goToReport">
        <text class="label">检举</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="card">
      <view class="leave-row" @click="onLeaveOrDismiss">
        <text class="leave-label">{{ isOwner ? '解散群' : '退出群并删除对话' }}</text>
      </view>
    </view>

    <view v-if="showJoinMode" class="sheet-mask" @click="showJoinMode = false">
      <view class="sheet" @click.stop>
        <view class="sheet-item" @click="selectJoinMode('open')">公开群（扫码入群）</view>
        <view class="sheet-item" @click="selectJoinMode('approval')">私密群（申请入群）</view>
        <view class="sheet-cancel" @click="showJoinMode = false">取消</view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 26rpx;
  background: #ffffff;
}

.back-btn {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #1f1f1f;
}

.header-spacer {
  width: 52rpx;
  height: 52rpx;
}

.card {
  margin-top: 16rpx;
  background: #fff;
}

.member-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
  padding: 20rpx 22rpx 8rpx;
  overflow: hidden;
}

.member-item {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.member-avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #eaeaea;
}

.member-name {
  font-size: 22rpx;
  color: #555;
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-member {
  width: 112rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 2rpx;
}

.add-circle {
  width: 90rpx;
  height: 90rpx;
  border-radius: 50%;
  border: 2rpx dashed #b8b8b8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 50rpx;
  color: #8a8a8a;
}

.group-row,
.info-row,
.switch-row,
.action-row {
  min-height: 96rpx;
  padding: 0 30rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1rpx solid #f0f0f0;
}

.group-row {
  border-top: 1rpx solid #f0f0f0;
}

.last {
  border-bottom: none;
}

.label {
  font-size: 30rpx;
  color: #1d1d1d;
}

.row-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.muted,
.value {
  font-size: 28rpx;
  color: #666;
  max-width: 360rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arrow {
  font-size: 40rpx;
  color: #999;
}

.avatar-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #e9f2ff;
}

.current-avatar {
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: #d8eaff;
}

.info-row-id {
  gap: 20rpx;
}

.id-box {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18rpx;
  flex: 1;
  min-width: 0;
}

.id-value {
  color: #444;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: right;
}

.copy-btn {
  min-width: 100rpx;
  height: 52rpx;
  padding: 0 22rpx;
  border-radius: 12rpx;
  background: #1e88ff;
  color: #fff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.leave-row {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.leave-label {
  font-size: 30rpx;
  color: #ff4d4f;
  font-weight: 500;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 20;
  display: flex;
  align-items: flex-end;
}

.sheet {
  width: 100%;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}

.sheet-item,
.sheet-cancel {
  height: 108rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #1d1d1d;
}

.sheet-item {
  border-bottom: 1rpx solid #f0f0f0;
}

.sheet-cancel {
  margin-top: 12rpx;
  border-top: 12rpx solid #f3f4f7;
  color: #666;
}
</style>
