<script setup lang="ts">
export interface MessageMenuItem {
  key: string
  label: string
  wide?: boolean
}

defineProps<{
  items: MessageMenuItem[]
  top: number
  left: number
}>()

const emit = defineEmits<{
  select: [key: string]
  close: []
}>()
</script>

<template>
  <view class="mask" @click="emit('close')" @touchmove.stop.prevent>
    <view
      class="menu"
      :style="{ top: `${top}px`, left: `${left}px` }"
      @click.stop
    >
      <view
        v-for="item in items"
        :key="item.key"
        class="cell"
        :class="{ wide: item.wide }"
        @click="emit('select', item.key)"
      >
        <text>{{ item.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.28);
}

.menu {
  position: fixed;
  width: 360rpx;
  background: #ffffff;
  border-radius: 16rpx;
  overflow: hidden;
  display: flex;
  flex-wrap: wrap;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
}

.cell {
  width: 50%;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #222;
  border-bottom: 1rpx solid #eee;
  border-right: 1rpx solid #eee;
  box-sizing: border-box;
}

.cell:nth-child(2n) {
  border-right: none;
}

.cell.wide {
  width: 100%;
  border-right: none;
}
</style>
