<script setup lang="ts">
/**
 * 设置聊天号（对齐微信号的习惯：字母+数字、只能改一次）。
 *
 * 格式规则以服务端为准（service.NormalizePublicID）：6-20 位、首位字母、其余只能字母数字，大小写按输入保留。
 * 这里只做即时提示，不拦提交 —— 真按后端规则驳回时，把后端那句话原样报给用户，
 * 免得两边规则不一致时前端把合法输入挡住。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { markProfileSaveSuccess } from '@/utils/profile-feedback'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()
const userStore = useUserStore()

const CHAT_ID_MIN = 6
const CHAT_ID_MAX = 20
const CHAT_ID_RE = /^[A-Za-z][A-Za-z0-9]{5,19}$/

const chatId = ref('')
const originalChatId = ref('')
const saving = ref(false)

const chatIdCount = computed(() => chatId.value.length)
/** 只提示、不拦：规则最终由服务端判定 */
const looksValid = computed(() => CHAT_ID_RE.test(chatId.value.trim()))
const canSubmit = computed(() => {
  const id = chatId.value.trim()
  return id.length > 0 && id !== originalChatId.value.trim()
})

onShow(() => {
  const current = userStore.profile?.publicId || ''
  chatId.value = current
  originalChatId.value = current
  if (userStore.isLoggedIn && !userStore.profile) {
    userStore.loadProfile().catch(() => undefined)
  }
})

function goBack() {
  uni.navigateBack()
}

function onChatIdInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  chatId.value = (detail?.value || '').slice(0, CHAT_ID_MAX)
}

function clearChatId() {
  chatId.value = ''
}

async function onConfirm() {
  const id = chatId.value.trim()
  if (!id) {
    uni.showToast({ title: '请输入聊天号', icon: 'none' })
    return
  }
  if (!CHAT_ID_RE.test(id)) {
    uni.showToast({ title: `聊天号需 ${CHAT_ID_MIN}-${CHAT_ID_MAX} 位，以字母开头`, icon: 'none' })
    return
  }
  if (!canSubmit.value) return

  saving.value = true
  try {
    await userStore.savePublicId(id)
    markProfileSaveSuccess()
    uni.navigateBack()
  } catch (e) {
    // 「已被使用」「只能修改一次」这类提示由后端给，原样展示
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="设置聊天号" @back="goBack" />

    <view class="form">
      <view class="input-row">
        <input
          class="input"
          type="text"
          :value="chatId"
          :maxlength="CHAT_ID_MAX"
          placeholder="字母开头，只能用字母和数字"
          placeholder-style="color:#636E86"
          :focus="true"
          @input="onChatIdInput"
        />
        <view v-if="chatId" class="clear-btn" @click="clearChatId">
          <text class="clear-icon">×</text>
        </view>
      </view>
      <view class="meta">
        <text class="hint" :class="{ warn: chatId && !looksValid }">
          {{ CHAT_ID_MIN }}-{{ CHAT_ID_MAX }} 位，字母开头，只能用字母和数字
        </text>
        <text class="count">{{ chatIdCount }}/{{ CHAT_ID_MAX }}</text>
      </view>

      <view class="tips">
        <text class="tip-line">· 聊天号是别人搜索你时用的号码，好友看不到你的手机号</text>
        <text class="tip-line">· 大小写会按输入保留，搜索时不区分大小写</text>
        <text class="tip-line">· 只能修改一次，改完就不能再改了，请谨慎设置</text>
      </view>
    </view>

    <view class="footer">
      <button
        class="confirm-btn"
        :class="{ 'is-enabled': canSubmit }"
        :loading="saving"
        :disabled="!canSubmit || saving"
        @click="onConfirm"
      >
        確認
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f4f7;
  display: flex;
  flex-direction: column;
}

.form {
  padding: 24rpx 40rpx 0;
  background: #fff;
}

.input-row {
  display: flex;
  align-items: center;
  min-height: 96rpx;
  border-bottom: 1rpx solid #e1e3ea;
}

.input {
  flex: 1;
  min-width: 0;
  height: 96rpx;
  font-size: 34rpx;
  color: #212121;
}

.clear-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #c8ccd6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 16rpx;
}

.clear-icon {
  font-size: 32rpx;
  line-height: 1;
  color: #fff;
  margin-top: -2rpx;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0 8rpx;
}

.hint,
.count {
  font-size: 24rpx;
  color: #636e86;
  line-height: 32rpx;
}

/* 只做提示，不拦提交，所以用橙色而不是红色 */
.hint.warn {
  color: #e59a1a;
}

.tips {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 16rpx 0 32rpx;
}

.tip-line {
  font-size: 24rpx;
  color: #8a8f9c;
  line-height: 36rpx;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx 40rpx calc(24rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.confirm-btn {
  width: 100%;
  height: 96rpx;
  border: none;
  border-radius: 16rpx;
  background: #c8ccd6;
  color: #fff;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 96rpx;

  &.is-enabled {
    background: #0a2fc2;
  }
}
</style>
