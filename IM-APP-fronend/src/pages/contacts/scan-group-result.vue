<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { joinGroupByQRCode, resolveGroupQRCode } from '@/api/group'
import { useContactStore } from '@/stores/contact'
import { APP_CONFIG } from '@/config'
import type { GroupInfo } from '@/types'

const contactStore = useContactStore()
const token = ref('')
const group = ref<GroupInfo | null>(null)
const nextAction = ref<'enter' | 'join' | 'apply'>('join')
const loading = ref(true)
const submitting = ref(false)

const avatarSrc = computed(() => group.value?.avatar || APP_CONFIG.defaultGroupAvatarUrl)

const primaryLabel = computed(() => {
  if (nextAction.value === 'enter') return '进入群聊'
  if (nextAction.value === 'apply') return '申请加入'
  return '加入群组'
})

onLoad(async (query) => {
  token.value = String(query?.token || '')
  if (!token.value) {
    loading.value = false
    uni.showToast({ title: '二维码无效', icon: 'none' })
    return
  }
  loading.value = true
  try {
    const result = await resolveGroupQRCode(token.value)
    group.value = result.group
    nextAction.value = result.nextAction
  } catch (e) {
    group.value = null
    uni.showToast({ title: (e as Error).message || '二维码无效或已过期', icon: 'none' })
  } finally {
    loading.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

async function enterGroup() {
  if (!group.value) return
  await contactStore.loadDirectory().catch(() => undefined)
  contactStore.openChatWithGroup(
    group.value.id,
    group.value.name,
    group.value.avatar || APP_CONFIG.defaultGroupAvatarUrl,
  )
}

async function onPrimary() {
  if (!group.value || submitting.value) return
  if (nextAction.value === 'enter') {
    await enterGroup()
    return
  }
  submitting.value = true
  try {
    const result = await joinGroupByQRCode(token.value)
    if (result.action === 'pending_approval') {
      nextAction.value = 'apply'
      uni.showToast({ title: '已提交入群申请', icon: 'success' })
      return
    }
    group.value = result.group
    nextAction.value = 'enter'
    await enterGroup()
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加入失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <image class="bg" :src="avatarSrc" mode="aspectFill" />
    <view class="bg-mask" />

    <view class="back-btn" @click="goBack">
      <image class="back-icon" src="/static/icons/icon-back-white.svg" mode="aspectFit" />
    </view>

    <view v-if="group" class="profile">
      <image class="avatar" :src="avatarSrc" mode="aspectFit" />
      <text class="name">{{ group.name }}</text>
    </view>

    <view v-if="loading" class="loading">
      <text class="loading-text">加载中...</text>
    </view>

    <view v-if="group" class="footer">
      <view class="chat-btn" :class="{ disabled: submitting }" @click="onPrimary">
        <image class="chat-icon" src="/static/icons/icon-chat-white.svg" mode="aspectFit" />
        <text class="chat-text">{{ primaryLabel }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background: #1a1a1a;
  box-sizing: border-box;
}

.bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  filter: blur(48rpx);
  transform: scale(1.25);
  z-index: 0;
}

.bg-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1;
}

.back-btn {
  position: absolute;
  left: 32rpx;
  top: calc(16rpx + env(safe-area-inset-top));
  z-index: 10;
  width: 96rpx;
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-icon {
  width: 48rpx;
  height: 48rpx;
}

.profile {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 28vh;
}

.avatar {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  background: #0a2fc2;
  border: 4rpx solid rgba(255, 255, 255, 0.35);
}

.name {
  margin-top: 28rpx;
  font-size: 34rpx;
  color: #fff;
  line-height: 48rpx;
  font-weight: 500;
}

.loading {
  position: relative;
  z-index: 5;
  padding-top: 40vh;
  text-align: center;
}

.loading-text {
  color: #fff;
  font-size: 28rpx;
}

.footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 24rpx 40rpx;
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
}

.chat-btn {
  height: 96rpx;
  border-radius: 48rpx;
  background: #0a2fc2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.chat-btn.disabled {
  opacity: 0.55;
}

.chat-icon {
  width: 40rpx;
  height: 40rpx;
}

.chat-text {
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
}
</style>
