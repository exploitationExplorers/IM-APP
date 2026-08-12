<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { searchUserByPublicId, fetchUserProfile, resolveUserQRCode } from '@/api/user'
import { useContactStore } from '@/stores/contact'
import type { UserInfo } from '@/types'

const contactStore = useContactStore()
const user = ref<UserInfo | null>(null)
const relation = ref<'self' | 'none' | 'pending' | 'friend' | 'blocked'>('none')
const loading = ref(true)

const isFriend = computed(() => {
  if (relation.value === 'friend') return true
  if (!user.value) return false
  return contactStore.contacts.some((c) => c.id === user.value!.id)
})

const primaryLabel = computed(() => {
  if (isFriend.value) return '聊天'
  if (relation.value === 'pending') return '已发送申请'
  if (relation.value === 'blocked') return '无法添加'
  return '加好友'
})

const primaryDisabled = computed(
  () => relation.value === 'pending' || relation.value === 'blocked' || relation.value === 'self',
)

const avatarSrc = computed(() => user.value?.avatar || '/static/avatar-me.png')

onLoad(async (query) => {
  const publicId = (query?.publicId as string) || ''
  const id = (query?.id as string) || ''
  const token = (query?.token as string) || ''
  loading.value = true
  try {
    await contactStore.loadAll()
    if (token) {
      const result = await resolveUserQRCode(token)
      relation.value = (result.relation || result.user.relation || 'none') as typeof relation.value
      user.value = {
        ...result.user,
        countryCode: result.user.countryCode || '+86',
      }
    } else if (publicId) {
      user.value = await searchUserByPublicId(publicId)
    } else if (id) {
      user.value = await fetchUserProfile(id)
    }
    if (!user.value) {
      uni.showToast({ title: '未找到用户', icon: 'none' })
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
})

function goBack() {
  uni.navigateBack()
}

async function onPrimary() {
  if (!user.value || primaryDisabled.value) return
  if (isFriend.value) {
    await contactStore.openChatWithContact(user.value.id, user.value.nickname, user.value.avatar)
    return
  }
  try {
    await contactStore.addFriend(user.value.id, '你好，我想加你为好友')
    uni.showToast({ title: '已发送好友申请', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
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

    <view v-if="user" class="profile">
      <image class="avatar" :src="avatarSrc" mode="aspectFill" />
      <text class="name">{{ user.nickname }}</text>
    </view>

    <view v-if="loading" class="loading">
      <text class="loading-text">加载中...</text>
    </view>

    <view v-if="user" class="footer">
      <view class="chat-btn" :class="{ disabled: primaryDisabled }" @click="onPrimary">
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
  background: #f3f4f7;
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
