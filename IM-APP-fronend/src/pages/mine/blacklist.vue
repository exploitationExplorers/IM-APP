<script setup lang="ts">
import { ref } from 'vue'
import AppSearchBar from '@/components/AppSearchBar.vue'

const keyword = ref('')
</script>

<template>
  <view class="page">
    <view class="search-wrap">
      <AppSearchBar v-model="keyword" placeholder="搜索" />
    </view>
    
    <view class="empty-wrap">
      <text class="empty-text">无资料</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}

.search-wrap {
  padding-top: 8rpx;
}

.empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-text {
  font-size: 30rpx;
  color: #8a8f9c;
}
</style>
