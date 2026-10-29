<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { APP_CONFIG, THEME } from '@/config'
import { sendSmsCode } from '@/api/auth'
import { deleteAccount, fetchDeletionPreview } from '@/api/account-deletion'
import type { AccountDeletionPreview } from '@/api/account-deletion'
import ImNavBar from '@/components/ImNavBar.vue'

/**
 * 账号注销（Apple 5.1.1(v) 合规要求：App 内必须能删除账号及关联数据）。
 *
 * 三级防护，避免误触：
 *   1. 前置检查（群主等阻碍项直接拦截，不让走到提交）
 *   2. 短信验证码（证明是机主本人）
 *   3. 提交前最后一次弹窗警告
 */

const userStore = useUserStore()

const loading = ref(true)
const preview = ref<AccountDeletionPreview | null>(null)
const loadError = ref('')

const code = ref('')
const sending = ref(false)
const countdown = ref(0)
const submitting = ref(false)
const understood = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

const phone = computed(() => String(userStore.profile?.phone || '').trim())
const countryCode = computed(() => String(userStore.profile?.countryCode || APP_CONFIG.defaultCountryCode || '+86'))
const phoneDisplay = computed(() => `${countryCode.value} ${phone.value}`)

const blockers = computed(() => preview.value?.blockers || [])
const canDelete = computed(() => !!preview.value?.canDelete)
const summary = computed(
  () =>
    preview.value?.summary || {
      friendCount: 0,
      groupCount: 0,
      ownedGroupCount: 0,
      favoriteCount: 0,
      fileCount: 0,
    },
)

const canSubmit = computed(
  () => canDelete.value && understood.value && code.value.trim().length >= 4 && !submitting.value,
)

onLoad(() => {
  void load()
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    preview.value = await fetchDeletionPreview()
  } catch (e) {
    loadError.value = (e as Error)?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/mine/profile' })
}

function onCodeInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  code.value = String(detail?.value || '').replace(/\D/g, '').slice(0, 6)
}

function startCountdown() {
  countdown.value = 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function onSendCode() {
  if (sending.value || countdown.value > 0) return
  if (!phone.value) {
    uni.showToast({ title: '未获取到手机号，请重新登录后再试', icon: 'none' })
    return
  }
  sending.value = true
  try {
    const result = await sendSmsCode(phone.value, 'delete_account', countryCode.value)
    startCountdown()
    if (result?.devCode) {
      uni.showToast({ title: `验证码：${result.devCode}`, icon: 'none', duration: 3000 })
    } else {
      uni.showToast({ title: '验证码已发送', icon: 'none' })
    }
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '发送失败', icon: 'none' })
  } finally {
    sending.value = false
  }
}

function onBlockerTap(blocker: { message?: string }) {
  uni.showToast({ title: blocker?.message || '请先处理该事项', icon: 'none', duration: 2500 })
}

function onSubmit() {
  if (!canSubmit.value) return
  uni.showModal({
    title: '最后一次确认',
    content: '账号将永久注销，业务资料、好友与群组关系、收藏等关联数据将立即删除且无法恢复。确定注销吗？',
    confirmText: '注销',
    confirmColor: THEME.danger,
    success: (res) => {
      if (res.confirm) void doDelete()
    },
  })
}

async function doDelete() {
  if (submitting.value) return
  submitting.value = true
  try {
    await deleteAccount({
      phone: phone.value,
      code: code.value.trim(),
      countryCode: countryCode.value,
      acknowledge: preview.value?.confirmPhrase || 'DELETE_MY_ACCOUNT',
    })
    uni.showToast({ title: '账号已注销', icon: 'none' })
    // 账号已删除，直接清理本地登录态与 SDK，避免再请求注销后的鉴权接口。
    await userStore.logoutAfterAccountDeletion()
    uni.reLaunch({ url: '/pages/auth/sign-in' })
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '注销失败，请稍后重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar
      title="注销账号"
      @back="goBack"
    />

    <view
      v-if="loading"
      class="state"
    >
      <text class="state-text">加载中…</text>
    </view>

    <view
      v-else-if="loadError"
      class="state"
    >
      <text class="state-text">{{ loadError }}</text>
      <button
        class="retry-btn"
        @click="load"
      >
        重试
      </button>
    </view>

    <template v-else>
      <view class="warn-card">
        <text class="warn-title">注销后不可恢复</text>
        <text class="warn-text">
          账号注销后，你的业务账号资料与好友、群组关系、收藏等关联数据将立即删除且无法恢复。
          聊天服务中的账号资料将按清理流程失效、下线或匿名化处理，其他设备上已保存的聊天内容不会同步消失；
          上传的文件与备份按平台清理策略轮转处理。该操作无法撤销。
        </text>
      </view>

      <view class="card">
        <text class="card-title">将同时删除</text>
        <view class="stat-row">
          <text class="stat-label">好友</text>
          <text class="stat-value">{{ summary.friendCount }} 位</text>
        </view>
        <view class="stat-row">
          <text class="stat-label">加入的群</text>
          <text class="stat-value">{{ summary.groupCount }} 个</text>
        </view>
        <view class="stat-row">
          <text class="stat-label">收藏</text>
          <text class="stat-value">{{ summary.favoriteCount }} 条</text>
        </view>
        <view class="stat-row">
          <text class="stat-label">文件（解除关联）</text>
          <text class="stat-value">{{ summary.fileCount }} 个</text>
        </view>
      </view>

      <view
        v-if="blockers.length"
        class="card blocker-card"
      >
        <text class="card-title blocker-title">注销前需要先处理</text>
        <view
          v-for="blocker in blockers"
          :key="blocker.groupId || blocker.code"
          class="blocker-row"
          @click="onBlockerTap(blocker)"
        >
          <text class="blocker-dot">•</text>
          <text class="blocker-text">{{ blocker.message }}</text>
        </view>
        <text class="blocker-hint">处理完成后返回本页，点击重试即可继续。</text>
      </view>
      <view
        v-else
        class="card"
      >
        <text class="card-title">验证手机号</text>
        <text class="verify-hint">我们将向 {{ phoneDisplay }} 发送验证码，确认是本人操作。</text>
        <view class="input-row">
          <input
            class="input"
            type="number"
            :value="code"
            :maxlength="6"
            placeholder="输入验证码"
            placeholder-style="color:#636E86"
            @input="onCodeInput"
          >
          <button
            class="code-btn"
            :disabled="sending || countdown > 0"
            @click="onSendCode"
          >
            {{ countdown > 0 ? `${countdown}s` : sending ? '发送中' : '发送验证码' }}
          </button>
        </view>
      </view>

      <view class="agree-row">
        <view
          class="checkbox"
          :class="{ 'is-checked': understood }"
          @click="understood = !understood"
        >
          <text
            v-if="understood"
            class="check-icon"
          >✓</text>
        </view>
        <text class="agree-text">我已了解：注销后数据永久删除且无法恢复。</text>
      </view>

      <view class="footer">
        <button
          class="confirm-btn"
          :class="{ 'is-enabled': canSubmit }"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          确认注销
        </button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding-bottom: 40rpx;
}

.state {
  padding: 80rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.state-text {
  font-size: 28rpx;
  color: #636e86;
}

.retry-btn {
  margin-top: 24rpx;
  padding: 0 48rpx;
  height: 72rpx;
  line-height: 72rpx;
  font-size: 28rpx;
  color: #2b5cff;
  background: #fff;
  border-radius: 36rpx;
}

.warn-card {
  margin: 24rpx 32rpx;
  padding: 28rpx;
  background: #fff2f0;
  border-radius: 20rpx;
}

.warn-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #d4380d;
}

.warn-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 40rpx;
  color: #8c4b3a;
}

.card {
  margin: 0 32rpx 24rpx;
  padding: 28rpx;
  background: #fff;
  border-radius: 20rpx;
}

.card-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2430;
}

.stat-row {
  margin-top: 18rpx;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

.stat-label {
  font-size: 27rpx;
  color: #636e86;
}

.stat-value {
  font-size: 27rpx;
  color: #1f2430;
}

.blocker-card {
  background: #fff7e6;
}

.blocker-title {
  color: #ad6800;
}

.blocker-row {
  margin-top: 16rpx;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
}

.blocker-dot {
  margin-right: 10rpx;
  font-size: 27rpx;
  color: #ad6800;
}

.blocker-text {
  flex: 1;
  font-size: 26rpx;
  line-height: 38rpx;
  color: #8a5a12;
}

.blocker-hint {
  display: block;
  margin-top: 18rpx;
  font-size: 24rpx;
  color: #a3803f;
}

.verify-hint {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 38rpx;
  color: #636e86;
}

.input-row {
  margin-top: 20rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.input {
  flex: 1;
  height: 88rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #1f2430;
  background: #f5f6f8;
  border-radius: 16rpx;
}

.code-btn {
  margin-left: 16rpx;
  padding: 0 24rpx;
  height: 88rpx;
  line-height: 88rpx;
  font-size: 26rpx;
  color: #2b5cff;
  background: #eef2ff;
  border-radius: 16rpx;
}

.agree-row {
  margin: 8rpx 32rpx 0;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.checkbox {
  width: 36rpx;
  height: 36rpx;
  border: 2rpx solid #c3cad8;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.checkbox.is-checked {
  background: #2b5cff;
  border-color: #2b5cff;
}

.check-icon {
  font-size: 24rpx;
  color: #fff;
}

.agree-text {
  margin-left: 14rpx;
  flex: 1;
  font-size: 25rpx;
  color: #636e86;
}

.footer {
  margin: 40rpx 32rpx 0;
}

.confirm-btn {
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  color: #fff;
  background: #c3cad8;
  border-radius: 46rpx;
}

.confirm-btn.is-enabled {
  background: #e5484d;
}
</style>
