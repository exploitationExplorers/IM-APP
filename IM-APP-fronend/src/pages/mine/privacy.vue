<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { usePrivacySettings } from '@/composables/usePrivacySettings'
import ImNavBar from '@/components/ImNavBar.vue'
import { backToChatHome } from '@/utils/nav'
import type { PrivacySettings } from '@/types'

const { settings, disabled, load, save } = usePrivacySettings()

onShow(async () => {
  try {
    await load()
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
  }
})

async function persist(key: keyof PrivacySettings, e: Event) {
  const value = (e as unknown as { detail: { value: boolean } }).detail.value
  try {
    if (await save(key, value)) {
      uni.showToast({ title: '已保存', icon: 'success' })
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  }
}

function onFriendVerify(e: Event) {
  void persist('requireFriendApproval', e)
}

function onGroupInviteVerify(e: Event) {
  void persist('requireGroupApproval', e)
}

function goBlacklist() {
  uni.navigateTo({
    url: '/pages/mine/blacklist',
  })
}
</script>

<template>
  <view class="page">
    <ImNavBar
      title="隐私"
      @back="backToChatHome"
    />
    <view class="cell">
      <text class="label">
        加我为好友需验证
      </text>
      <switch
        :checked="settings.requireFriendApproval"
        :disabled="disabled"
        color="#0A2FC2"
        style="transform:scale(0.8)"
        @change="onFriendVerify"
      />
    </view>
    <view class="cell">
      <text class="label">
        邀请我加入群聊需验证
      </text>
      <switch
        :checked="settings.requireGroupApproval"
        :disabled="disabled"
        color="#0A2FC2"
        style="transform:scale(0.8)"
        @change="onGroupInviteVerify"
      />
    </view>
    <view
      class="cell"
      @click="goBlacklist"
    >
      <text class="label">
        黑名单
      </text>
      <text class="arrow">
        ›
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
  padding: 28rpx 32rpx;
  min-height: 96rpx;
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
