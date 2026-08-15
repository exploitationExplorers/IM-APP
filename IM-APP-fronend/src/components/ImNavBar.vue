<script setup lang="ts">
/**
 * 自定义导航栏。
 * App 端 navigationStyle:custom 时页面从状态栏底部开始绘制，
 * 需自行让出状态栏高度；H5 端 statusBarHeight 为 0，样式不受影响。
 */
defineProps<{
  title: string
}>()

const emit = defineEmits<{ (e: 'back'): void }>()

const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
</script>

<template>
  <view class="im-nav" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="im-nav-row">
      <view class="im-nav-back" @click="emit('back')">‹</view>
      <text class="im-nav-title">{{ title }}</text>
      <view class="im-nav-side">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.im-nav {
  background: #fff;
}

.im-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 26rpx;
}

.im-nav-back {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #1b1b1b;
}

.im-nav-title {
  flex: 1;
  text-align: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #1f1f1f;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.im-nav-side {
  width: 52rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
</style>
