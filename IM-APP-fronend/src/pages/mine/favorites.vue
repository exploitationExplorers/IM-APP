<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'

defineProps<{
  // unused, page is static
}>()
</script>

<template>
  <view class="page">
    <EmptyState text="暂无收藏内容" />
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #fff;
}
</style>
