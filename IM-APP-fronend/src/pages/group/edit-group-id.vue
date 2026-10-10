<script setup lang="ts">
/**
 * 设置群号（对齐聊天号：qun_ 前缀、只能改一次）。
 * 格式以服务端为准：^qun_[A-Za-z0-9]{6,20}$
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { updateGroupPublicId } from '@/api/group'
import { useAuthGuard } from '@/composables/useAuthGuard'
import ImNavBar from '@/components/ImNavBar.vue'

useAuthGuard()

const GROUP_ID_PREFIX = 'qun_'
const SUFFIX_MIN = 6
const SUFFIX_MAX = 20
const GROUP_ID_RE = /^qun_[A-Za-z0-9]{6,20}$/

const groupId = ref('')
const publicId = ref('')
const originalId = ref('')
const saving = ref(false)

const idCount = computed(() => publicId.value.length)
const looksValid = computed(() => GROUP_ID_RE.test(publicId.value.trim()))
const canSubmit = computed(() => {
  const id = publicId.value.trim()
  return id.length > 0 && id.toLowerCase() !== originalId.value.trim().toLowerCase()
})

onLoad((query) => {
  const id = String(query?.id || '')
  groupId.value = id
  publicId.value = id
  originalId.value = id
})

function goBack() {
  uni.navigateBack()
}

function onInput(e: Event) {
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  publicId.value = (detail?.value || '').slice(0, GROUP_ID_PREFIX.length + SUFFIX_MAX)
}

function clearId() {
  publicId.value = GROUP_ID_PREFIX
}

async function onConfirm() {
  const id = publicId.value.trim()
  if (!id) {
    uni.showToast({ title: '请输入群号', icon: 'none' })
    return
  }
  if (!GROUP_ID_RE.test(id)) {
    uni.showToast({
      title: `群号需 ${GROUP_ID_PREFIX} 开头，后接 ${SUFFIX_MIN}-${SUFFIX_MAX} 位字母或数字`,
      icon: 'none',
    })
    return
  }
  if (!canSubmit.value || !groupId.value) return

  saving.value = true
  try {
    const g = await updateGroupPublicId(groupId.value, id)
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => {
      uni.redirectTo({
        url: `/pages/group/detail?id=${encodeURIComponent(g.id || id)}`,
      })
    }, 400)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <ImNavBar title="设置群号" @back="goBack" />

    <view class="form">
      <view class="input-row">
        <input
          class="input"
          type="text"
          :value="publicId"
          :maxlength="GROUP_ID_PREFIX.length + SUFFIX_MAX"
          placeholder="qun_ 开头，后接字母或数字"
          placeholder-style="color:#636E86"
          :focus="true"
          @input="onInput"
        />
        <view v-if="publicId" class="clear-btn" @click="clearId">
          <text class="clear-icon">×</text>
        </view>
      </view>
      <view class="meta">
        <text class="hint" :class="{ warn: publicId && !looksValid }">
          {{ GROUP_ID_PREFIX }} 开头，后接 {{ SUFFIX_MIN }}-{{ SUFFIX_MAX }} 位字母或数字
        </text>
        <text class="count">{{ idCount }}/{{ GROUP_ID_PREFIX.length + SUFFIX_MAX }}</text>
      </view>

      <view class="tips">
        <text class="tip-line">· 群号用于加群搜索，别人知道群号后可以申请加入</text>
        <text class="tip-line">· 大小写按输入保留，搜索时不区分大小写</text>
        <text class="tip-line">· 每个群只能修改一次，改完就不能再改了，请谨慎设置</text>
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
        确认
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
