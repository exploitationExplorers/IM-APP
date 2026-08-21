<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import ImMessageComposer, { type ComposerContent } from '@/components/ImMessageComposer.vue'
import ImNavBar from '@/components/ImNavBar.vue'
import { useMassSendStore } from '@/stores/massSend'

const massStore = useMassSendStore()
const sending = ref(false)

const targetsText = computed(() => {
  const list = massStore.selectedTargets.map((t) => t.name).filter(Boolean)
  if (!list.length) return ''
  return list.slice(0, 4).join('，') + (list.length > 4 ? '...' : '')
})

onShow(() => {
  if (!massStore.selectedTargets.length) {
    uni.showToast({ title: '请先选择联系人', icon: 'none' })
    uni.redirectTo({ url: '/pages/mine/mass-select-contacts' })
  }
})

function goBack() {
  uni.navigateBack()
}

function goEditTargets() {
  uni.navigateTo({ url: '/pages/mine/mass-targets' })
}

function backToAssistant() {
  const pages = (getCurrentPages?.() || []) as unknown as { length: number }[]
  if (pages.length >= 3) {
    uni.navigateBack({ delta: 2 })
    return
  }
  uni.redirectTo({ url: '/pages/mine/mass-assistant' })
}

function goFavorites() {
  uni.navigateTo({ url: '/pages/mine/favorites?mode=pick' })
}

function onFavoritePicked(item: unknown) {
  if (!item) return
  uni.showToast({ title: '已选择收藏内容', icon: 'success' })
}

function mockSend(content: ComposerContent) {
  if (sending.value) return
  sending.value = true
  uni.showLoading({ title: '发送中...' })
  setTimeout(() => {
    uni.hideLoading()
    massStore.send(content)
    uni.showToast({ title: '已发送', icon: 'success' })
    sending.value = false
    backToAssistant()
  }, 600)
}

defineExpose({
  onFavoritePicked,
})
</script>

<template>
  <view class="page">
    <ImNavBar title="群发" @back="goBack" />

    <view class="targets" @click="goEditTargets">
      <text class="targets-tip">你将发送消息给</text>
      <view class="targets-row">
        <text class="targets-names">{{ targetsText }}</text>
        <text class="targets-arrow">›</text>
      </view>
    </view>

    <view class="space"></view>

    <ImMessageComposer placeholder="输入消息" @submit="mockSend" @open-favorites="goFavorites" />
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}

.targets {
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f1f4;
}

.targets-tip {
  font-size: 26rpx;
  color: #8a8f9c;
}

.targets-row {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.targets-names {
  flex: 1;
  font-size: 28rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.targets-arrow {
  color: #c8ccd6;
  font-size: 36rpx;
}

.space {
  flex: 1;
  background: #f3f4f7;
}
</style>
