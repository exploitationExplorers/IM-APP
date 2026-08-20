<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { updateMyNickname, fetchGroupDetail } from '@/api/group'
import { useGroupStore } from '@/stores/group'
import ImNavBar from '@/components/ImNavBar.vue'

const NICKNAME_MAX = 32
const groupId = ref('')
const nickname = ref('')
const saving = ref(false)
const canSubmit = ref(true)

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  const store = useGroupStore()
  const current = store.currentGroup
  if (current && current.id === groupId.value) {
    nickname.value = current.myNickname?.trim() || ''
  } else {
    try {
      const g = await fetchGroupDetail(groupId.value)
      nickname.value = g.myNickname?.trim() || ''
    } catch (e) {
      uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
    }
  }
})

function goBack() {
  uni.navigateBack()
}

async function onSubmit() {
  if (!groupId.value || saving.value) return
  const value = nickname.value.trim()
  if (value.length > NICKNAME_MAX) {
    uni.showToast({ title: `昵称最多 ${NICKNAME_MAX} 个字`, icon: 'none' })
    return
  }
  saving.value = true
  try {
    await updateMyNickname(groupId.value, value)
    const store = useGroupStore()
    await store.loadDetail(groupId.value)
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
    <ImNavBar title="我在本群的昵称" @back="goBack" />

    <view class="form">
      <input
        class="input"
        v-model="nickname"
        :maxlength="NICKNAME_MAX"
        placeholder="未设置"
      />
      <view class="meta">
        <text class="hint">仅群内成员可见，最多 {{ NICKNAME_MAX }} 个字</text>
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
.form {
  margin-top: 24rpx;
  background: #fff;
  padding: 32rpx;
}
.input {
  width: 100%;
  height: 80rpx;
  font-size: 30rpx;
  color: #212121;
  padding: 0 8rpx;
}
.meta {
  margin-top: 16rpx;
}
.hint {
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
