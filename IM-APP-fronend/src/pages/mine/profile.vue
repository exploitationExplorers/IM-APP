<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const nickname = ref('')
const bio = ref('')
const saving = ref(false)

onMounted(() => {
  nickname.value = userStore.profile?.nickname || ''
  bio.value = userStore.profile?.bio || ''
})

async function onSave() {
  if (!nickname.value.trim()) {
    uni.showToast({ title: '请输入昵称', icon: 'none' })
    return
  }
  saving.value = true
  try {
    await userStore.saveProfile({
      nickname: nickname.value.trim(),
      bio: bio.value,
    })
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 400)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">昵称</text>
      <input class="input" v-model="nickname" placeholder="请输入昵称" maxlength="32" />
    </view>
    <view class="cell">
      <text class="label">个性签名</text>
      <input class="input" v-model="bio" placeholder="一句话介绍自己" />
    </view>
    <button class="btn" :loading="saving" @click="onSave">保存</button>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f6f8;
  padding-top: 16rpx;
}

.cell {
  background: #fff;
  padding: 28rpx;
  display: flex;
  align-items: center;
  border-bottom: 1rpx solid #f0f0f0;
}

.label {
  width: 160rpx;
  color: #666;
  font-size: 28rpx;
}

.input {
  flex: 1;
  font-size: 28rpx;
}

.btn {
  margin: 48rpx 32rpx;
  background: #2b5cff;
  color: #fff;
  border-radius: 12rpx;
}

.btn::after {
  border: none;
}
</style>
