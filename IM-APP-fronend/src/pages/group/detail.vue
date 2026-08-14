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
} from '@/utils/openim'
import { resolveIMGroup } from '@/api/im'

const groupStore = useGroupStore()
const chatStore = useChatStore()
const groupId = ref('')
const code = ref('group')

const groupDetail = computed(() => groupStore.currentGroup)
const memberList = computed(() => groupStore.members)
const groupName = computed(() => groupDetail.value?.name || '群聊')
const avatar = computed(() => groupDetail.value?.avatar || '/static/avatar-1.png')
const memberCount = computed(() => groupDetail.value?.memberCount ?? memberList.value.length)

// 会话级设置：进入页面时从本地会话列表读取当前状态（OpenIM 已云同步）
const convId = ref('')
const recvOpt = ref<number>(MessageReceiveOptType.Normal)
const pinned = ref(false)

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  code.value = String(query?.code || 'group')

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

/**
 * 取该群的 OpenIM 会话并读出当前置顶 / 免打扰状态。
 * 优先用本地缓存（按 OpenIM 会话 ID 匹配）；没有则让 SDK 建会话（或后端兜底），保证开关与真实状态一致。
 */
async function initConversationSettings() {
  try {
    const target = await resolveIMGroup(groupId.value)
    const conversationID = `sg_${target.imGroupId}`
    const cached = chatStore.conversations.find((c) => c.id === conversationID)
    const conv = cached || (await chatStore.enterConversation({ type: 'group', businessId: groupId.value }))
    convId.value = conv.id
    recvOpt.value = conv.recvMsgOpt ?? MessageReceiveOptType.Normal
    pinned.value = conv.pinned ?? false
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

function goToChat() {
  uni.navigateTo({
    url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(groupId.value)}&title=${encodeURIComponent(groupName.value)}&avatar=${encodeURIComponent(avatar.value)}`,
  })
}

function goBack() {
  uni.navigateBack()
}

function goToMembers() {
  uni.navigateTo({
    url: `/pages/group/members?id=${encodeURIComponent(groupId.value)}`,
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

function goToClearHistory() {
  uni.navigateTo({
    url: `/pages/group/clear-history?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToReport() {
  uni.navigateTo({
    url: `/pages/group/report?id=${encodeURIComponent(groupId.value)}`,
  })
}

function goToLeaveGroup() {
  uni.navigateTo({
    url: `/pages/group/leave?id=${encodeURIComponent(groupId.value)}`,
  })
}

function copyGroupId() {
  uni.setClipboardData({
    data: groupId.value,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}
</script>

<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack">‹</view>
      <text class="title">群详细</text>
      <view class="header-spacer" />
    </view>

    <view class="members-wrap">
      <view class="member-row" @click="goToMembers">
        <view v-for="member in memberList" :key="member.id" class="member-item">
          <image class="member-avatar" :src="member.avatar" mode="aspectFill" />
          <text class="member-name">{{ member.nickname }}</text>
        </view>
        <view v-if="memberList.length" class="add-member" @click.stop="goToMembers">
          <view class="add-circle">＋</view>
        </view>
      </view>
    </view>

    <view class="group-row section-row" @click="goToMembers">
      <text class="label">群组成员</text>
      <view class="row-right">
        <text class="muted">共{{ memberCount }}人</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="info-list">
      <view class="chat-entry" @click="goToChat">
        <text class="chat-entry-text">进入群聊</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row">
        <text class="label">群组名称</text>
        <text class="value">{{ groupName }}</text>
      </view>

      <view class="info-row">
        <text class="label">群头像</text>
        <view class="avatar-box">
          <image class="current-avatar" :src="avatar" mode="aspectFill" />
        </view>
      </view>

      <view class="info-row info-row-id">
        <text class="label">群ID</text>
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

      <view class="info-row nav-row" @click="goToMyNickname">
        <text class="label">我在本群的昵称</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row" @click="goToMedia">
        <text class="label">图片与视频</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row" @click="goToSearchHistory">
        <text class="label">搜索聊天记录</text>
        <text class="arrow">›</text>
      </view>

      <view class="info-row nav-row last-nav" @click="goToClearHistory">
        <text class="label">清除聊天记录</text>
        <text class="arrow">›</text>
      </view>

      <view class="switch-row">
        <text class="label">消息免打扰</text>
        <ImSwitch :model-value="recvOpt === MessageReceiveOptType.NotNotify" @change="onToggleRecv" />
      </view>

      <view class="switch-row">
        <text class="label">置顶聊天</text>
        <ImSwitch :model-value="pinned" @change="onTogglePin" />
      </view>

      <view class="action-row" @click="goToReport">
        <text class="label">检举</text>
        <text class="arrow">›</text>
      </view>

      <view class="leave-row" @click="goToLeaveGroup">
        <text class="leave-label">退出群并删除对话</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f5f5;
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

.members-wrap {
  background: #fff;
  padding: 20rpx 22rpx 18rpx;
}

.member-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
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

.section-row {
  margin-top: 18rpx;
  border-top: 1rpx solid #f0f0f0;
  border-bottom: 1rpx solid #f0f0f0;
}

.group-row {
  background: #fff;
  padding: 28rpx 30rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.label {
  font-size: 30rpx;
  color: #1d1d1d;
}

.row-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.muted {
  font-size: 28rpx;
  color: #666;
}

.arrow {
  font-size: 40rpx;
  color: #999;
}

.info-list {
  margin-top: 8rpx;
  background: #fff;
}

.chat-entry {
  min-height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  background: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.chat-entry-text {
  font-size: 30rpx;
  color: #1d1d1d;
  font-weight: 500;
}

.info-row {
  min-height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.value {
  font-size: 30rpx;
  color: #666;
  max-width: 50%;
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

.nav-row {
  cursor: pointer;
}

.last-nav {
  border-bottom: 1rpx solid #f0f0f0;
}

.switch-row {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  background: #fff;
  border-bottom: 1rpx solid #f0f0f0;
}

.switch-track {
  width: 76rpx;
  height: 40rpx;
  border-radius: 24rpx;
  background: #d9d9d9;
  position: relative;
  display: flex;
  align-items: center;
  padding: 4rpx;
}

.switch-knob {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.16);
  position: absolute;
  left: 6rpx;
}

.action-row {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 30rpx;
  background: #fff;
}

.leave-row {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 30rpx;
  background: #fff;
  margin-top: 18rpx;
}

.leave-label {
  font-size: 30rpx;
  color: #ff4d4f;
  font-weight: 500;
}
</style>
