<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onShow } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'
import ImSwitch from '@/components/ImSwitch.vue'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useChatStore } from '@/stores/chat'
import { backToChatHome } from '@/utils/nav'
import { businessUserIdFromIM, ensureIMLogin } from '@/utils/openim'
import { clearConversationHistory, resolveIMGroupByIM } from '@/api/im'
import type { Conversation } from '@/types'

const settingsStore = useChatSettingsStore()
const { enterToSend } = storeToRefs(settingsStore)

onShow(() => {
  // 进页再对齐一次磁盘，避免「设了过一会开关自己关掉」
  settingsStore.hydrate(true)
})

function onEnterChange(value: boolean) {
  settingsStore.setEnterToSend(!!value)
}

/** 会话的业务侧 peer ID（服务端清漫游接口按业务 ID 定位） */
async function businessPeerIdOf(conv: Conversation): Promise<string> {
  if (conv.type === 'group') {
    const group = await resolveIMGroupByIM(conv.groupId || '')
    return group.businessGroupId
  }
  return businessUserIdFromIM(conv.peerUserId || '')
}

async function onClear() {
  const res = await uni.showModal({
    title: '清除聊天记录',
    content: '聊天记录将从你的所有设备中删除，不会影响其他人的聊天记录',
    confirmText: '确认',
    cancelText: '取消',
  })
  if (!res.confirm) return

  const chatStore = useChatStore()
  const list = chatStore.conversations.slice()
  if (!list.length) {
    uni.showToast({ title: '暂无聊天记录', icon: 'none' })
    return
  }

  const cleared = { server: 0, localOnly: 0 }
  uni.showLoading({ title: '清除中...', mask: true })
  try {
    await ensureIMLogin()
    // 逐会话清：服务端清漫游失败时降级为仅清本端，不中断整体
    for (const conv of list) {
      try {
        const peerId = await businessPeerIdOf(conv)
        await clearConversationHistory(conv.type === 'group' ? 'group' : 'c2c', peerId)
        cleared.server += 1
      } catch (e) {
        console.warn('[chat-settings] 服务端清除失败，仅清本端', conv.id, e)
        cleared.localOnly += 1
      }
      await chatStore.clearHistory(conv.id)
    }
  } finally {
    uni.hideLoading()
  }
  if (cleared.localOnly) {
    uni.showToast({ title: `已清除（${cleared.localOnly} 个会话仅清本端）`, icon: 'none' })
  } else {
    uni.showToast({ title: '已清除', icon: 'success' })
  }
}

function goMassAssistant() {
  uni.navigateTo({ url: '/pages/mine/mass-assistant' })
}

function goEmotions() {
  uni.navigateTo({
    url: '/pages/mine/emotions',
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar
      title="聊天设置"
      @back="backToChatHome"
    />
    <view class="cell">
      <text class="label">
        回车键送出消息
      </text>
      <!-- 不用原生 switch：部分端会在 checked 绑定时误发 change，把已开状态冲成关 -->
      <ImSwitch
        :model-value="enterToSend"
        @change="onEnterChange"
      />
    </view>
    <view
      class="cell"
      @click="goMassAssistant"
    >
      <text class="label">
        群发助手
      </text>
      <text class="arrow">
        ›
      </text>
    </view>
    <view
      class="cell"
      @click="goEmotions"
    >
      <text class="label">
        我的表情
      </text>
      <text class="arrow">
        ›
      </text>
    </view>
    <view
      class="cell"
      @click="onClear"
    >
      <text class="label">
        清除聊天记录
      </text>
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
  padding: 20rpx 32rpx;
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
