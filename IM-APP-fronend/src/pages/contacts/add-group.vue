<script setup lang="ts">
import { ref } from 'vue'
import ImNavBar from '@/components/ImNavBar.vue'
import { createJoinRequest, joinGroup } from '@/api/group'
import { useContactStore } from '@/stores/contact'
import { useDesktopLayout } from '@/composables/useDesktopLayout'
import { openQrScanner } from '@/utils/qrcode'
import { APP_CONFIG } from '@/config'

const contactStore = useContactStore()
const { isDesktop } = useDesktopLayout()
const groupId = ref('')
const submitting = ref(false)

function goBack() {
  uni.navigateBack()
}

function goScan() {
  openQrScanner()
}

async function openJoined(id: string, name: string, avatar: string) {
  await contactStore.loadDirectory().catch(() => undefined)
  if (isDesktop.value) {
    await contactStore.openChatWithGroupDesktop(id, name, avatar)
    return
  }
  contactStore.openChatWithGroup(id, name, avatar)
}

async function onJoin() {
  const id = groupId.value.trim()
  // 新群号 qun_xxx；兼容极少数未迁移的纯数字号
  if (!/^(qun_[A-Za-z0-9]{6,20}|\d+)$/.test(id)) {
    uni.showToast({ title: '请输入正确的群号', icon: 'none' })
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    const group = await joinGroup(id)
    await openJoined(
      group.id || id,
      group.name || '群聊',
      group.avatar || APP_CONFIG.defaultGroupAvatarUrl,
    )
  } catch (e) {
    const msg = (e as Error).message || '加入失败'
    if (msg.includes('审核')) {
      try {
        await createJoinRequest(id, '')
        uni.showToast({ title: '已提交入群申请', icon: 'success' })
      } catch (err) {
        uni.showToast({ title: (err as Error).message || '提交入群申请失败', icon: 'none' })
      }
      return
    }
    uni.showToast({ title: msg === '加入失败' ? '群不存在或无法加入' : msg, icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="添加群聊" @back="goBack">
      <template #right>
        <view class="nav-btn" @click="goScan">
          <image class="nav-icon" src="/static/icons/icon-scan.svg" mode="aspectFit" />
        </view>
      </template>
    </ImNavBar>

    <view class="search-wrap">
      <view class="search-box">
        <input
          class="search-input"
          v-model="groupId"
          type="text"
          maxlength="28"
          placeholder="输入群号，如 qun_xxxx"
          placeholder-class="search-ph"
          confirm-type="done"
          @confirm="onJoin"
        />
      </view>
      <text class="hint">输入对方群资料里的群号（qun_ 开头）。右上角仍可扫群二维码。</text>
    </view>

    <view class="footer">
      <view class="primary-btn" :class="{ disabled: submitting }" @click="onJoin">
        {{ submitting ? '加入中...' : '加入群聊' }}
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  height: 100vh;
  height: 100dvh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
}

.nav-btn {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-icon {
  width: 48rpx;
  height: 48rpx;
}

.search-wrap {
  padding: 16rpx 40rpx 24rpx;
  flex-shrink: 0;
}

.search-box {
  display: flex;
  align-items: center;
  height: 72rpx;
  padding: 0 32rpx;
  background: #f3f4f7;
  border-radius: 8rpx;
}

.search-input {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: #212121;
  height: 72rpx;
}

.search-ph {
  color: #626e8d;
}

.hint {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #626e8d;
  line-height: 36rpx;
}

.footer {
  flex-shrink: 0;
  padding: 16rpx 40rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
}

.primary-btn {
  height: 96rpx;
  border-radius: 8rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.primary-btn.disabled {
  opacity: 0.7;
}
</style>
