<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { updateContact } from '@/api/contact'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useContactStore } from '@/stores/contact'
import { useChatStore } from '@/stores/chat'

useAuthGuard()

const contactStore = useContactStore()
const chatStore = useChatStore()
const REMARK_MAX = 50
const contactId = ref('')
const nickname = ref('')
const remark = ref('')
const saving = ref(false)

const count = computed(() => remark.value.length)
const canSubmit = computed(() => !saving.value)

onLoad((query) => {
  contactId.value = String(query?.id || '')
  nickname.value = decodeURIComponent(String(query?.nickname || ''))
  remark.value = decodeURIComponent(String(query?.remark || ''))
})

function goBack() {
  uni.navigateBack()
}

async function onSubmit() {
  if (!contactId.value || saving.value) return
  const value = remark.value.trim()
  if (value.length > REMARK_MAX) {
    uni.showToast({ title: `备注名最多 ${REMARK_MAX} 个字`, icon: 'none' })
    return
  }
  saving.value = true
  try {
    await updateContact(contactId.value, { remark: value })
    await contactStore.reloadContacts({
      keyword: contactStore.contactKeyword,
      sort: contactStore.contactSort,
    })
    chatStore.applyContactRemarks()
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 300)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">
        <image class="nav-icon" src="/static/icons/icon-back.svg" mode="aspectFit" />
      </view>
      <text class="nav-title">备注名</text>
      <view class="nav-spacer" />
    </view>

    <view class="form">
      <textarea
        class="input"
        v-model="remark"
        :maxlength="REMARK_MAX"
        :placeholder="nickname || '请输入备注名'"
        auto-height
      />
      <view class="meta">
        <text class="hint">备注名最多 {{ REMARK_MAX }} 个字</text>
        <text class="count">{{ count }}/{{ REMARK_MAX }}</text>
      </view>
    </view>

    <view class="footer">
      <button class="btn" :disabled="!canSubmit" @click="onSubmit">确认</button>
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

.nav {
  display: flex;
  align-items: center;
  height: calc(88rpx + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 24rpx 0;
  background: #fff;
  border-bottom: 1rpx solid #e1e3ea;
  box-sizing: border-box;
}

.nav-back,
.nav-spacer {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-icon {
  width: 40rpx;
  height: 40rpx;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #212121;
}

.form {
  margin-top: 24rpx;
  background: #fff;
  padding: 32rpx;
}

.input {
  width: 100%;
  min-height: 120rpx;
  font-size: 30rpx;
  color: #212121;
  line-height: 1.5;
}

.meta {
  margin-top: 16rpx;
  display: flex;
  justify-content: space-between;
}

.hint,
.count {
  font-size: 24rpx;
  color: #636e86;
}

.footer {
  margin-top: auto;
  padding: 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.btn {
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 16rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}

.btn[disabled] {
  opacity: 0.5;
}

.btn::after {
  border: none;
}
</style>
