<script setup lang="ts">
import { computed } from 'vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const phoneDisplay = computed(() => {
  const p = userStore.profile
  if (!p) return ''
  const code = (p.countryCode || '86').replace(/^\+/, '')
  return `${code} ${p.phone || ''}`
})

function goNext() {
  uni.showToast({ title: '修改密码开发中', icon: 'none' })
}
</script>

<template>
  <view class="page">
    <view class="cell">
      <text class="label">手机号码</text>
      <text class="value">{{ phoneDisplay }}</text>
    </view>
    <view class="cell" @click="goNext">
      <text class="label">旧密码</text>
      <view class="right">
        <text class="next">下一步</text>
        <text class="arrow">›</text>
      </view>
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

.value {
  font-size: 28rpx;
  color: #636e86;
}

.right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.next {
  font-size: 28rpx;
  color: #636e86;
}

.arrow {
  color: #c8ccd6;
  font-size: 32rpx;
}
</style>
