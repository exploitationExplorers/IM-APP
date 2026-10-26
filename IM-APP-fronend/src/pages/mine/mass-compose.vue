<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import ImMessageComposer, { type ComposerContent } from '@/components/ImMessageComposer.vue'
import ImNavBar from '@/components/ImNavBar.vue'
import { useMassSendStore, type MassContent } from '@/stores/massSend'
import { dispatchMassContent } from '@/utils/massDispatch'

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

function toMassContent(content: ComposerContent): MassContent {
  return {
    type: content.type === 'favorite' ? 'favorite' : content.type,
    text: content.text,
    images: content.images,
    imageNames: content.imageNames,
    filePath: content.filePath,
    fileName: content.fileName,
    audioPath: content.audioPath,
    audioDuration: content.audioDuration,
  }
}

async function onSend(content: ComposerContent) {
  if (sending.value) return
  sending.value = true
  uni.showLoading({ title: '发送中...', mask: true })
  try {
    const result = await dispatchMassContent(massStore.selectedTargets, toMassContent(content))
    uni.hideLoading()
    massStore.send(toMassContent(content))
    if (result.failed.length) {
      const names = result.failed
        .slice(0, 5)
        .map((f) => `${f.name}（${f.reason}）`)
        .join('\n')
      const more = result.failed.length > 5 ? `\n...等共 ${result.failed.length} 个失败` : ''
      uni.showModal({
        title: `已发送 ${result.sent} 个，${result.failed.length} 个失败`,
        content: `${names}${more}`,
        showCancel: false,
        confirmText: '知道了',
      })
    } else {
      uni.showToast({ title: '已发送', icon: 'success' })
    }
    backToAssistant()
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error)?.message || '发送失败', icon: 'none', duration: 2500 })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar
      title="群发"
      @back="goBack"
    />

    <view
      class="targets"
      @click="goEditTargets"
    >
      <text class="targets-tip">
        你将发送消息给
      </text>
      <view class="targets-row">
        <text class="targets-names">
          {{ targetsText }}
        </text>
        <text class="targets-arrow">
          ›
        </text>
      </view>
    </view>

    <view class="space" />

    <ImMessageComposer
      placeholder="输入消息"
      :show-favorite="false"
      @submit="onSend"
    />
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
