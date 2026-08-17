<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchGroupDetail } from '@/api/group'
import { useGroupStore } from '@/stores/group'

const NAME_MAX = 50
const groupStore = useGroupStore()
const groupId = ref('')
const name = ref('')
const original = ref('')
const saving = ref(false)

const count = computed(() => name.value.length)
const canSubmit = computed(() => {
  const value = name.value.trim()
  return value.length > 0 && value !== original.value.trim() && !saving.value
})

onLoad(async (query) => {
  groupId.value = String(query?.id || '')
  if (!groupId.value) return
  try {
    const g = await fetchGroupDetail(groupId.value)
    name.value = g.name || ''
    original.value = g.name || ''
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '加载失败', icon: 'none' })
  }
})

function goBack() {
  uni.navigateBack()
}

async function onSubmit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    await groupStore.updateSettings(groupId.value, { name: name.value.trim() })
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 300)
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack">‹</view>
      <text class="nav-title">修改群组名称</text>
      <view class="nav-space" />
    </view>

    <view class="form">
      <input class="input" v-model="name" :maxlength="NAME_MAX" placeholder="请输入群组名称" />
      <view class="meta">
        <text class="hint">群组名称最多 {{ NAME_MAX }} 个字</text>
        <text class="count">{{ count }}/{{ NAME_MAX }}</text>
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
  height: 96rpx;
  padding: 0 26rpx;
  background: #fff;
}

.nav-back,
.nav-space {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 36rpx;
  font-weight: 700;
}

.form {
  margin-top: 16rpx;
  background: #fff;
  padding: 32rpx;
}

.input {
  width: 100%;
  height: 80rpx;
  font-size: 30rpx;
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
  opacity: 0.45;
}

.btn::after {
  border: none;
}
</style>
