<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import ImNavBar from '@/components/ImNavBar.vue'

const groupId = ref('')

onLoad((query) => {
  groupId.value = String(query?.id || '')
})

function goBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page">
    <ImNavBar title="清除聊天记录" @back="goBack" />

    <view class="empty">
      <text>此功能待实现</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f5f5;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 240rpx;
  color: #8a8f9c;
  font-size: 28rpx;
}
</style>
