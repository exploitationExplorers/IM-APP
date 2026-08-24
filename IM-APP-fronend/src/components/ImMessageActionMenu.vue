<script setup lang="ts">
import { computed } from 'vue'

export interface MessageMenuItem {
  key: string
  label: string
  wide?: boolean
  /** 参考站「多选」右侧占位格，保持 5 行双列网格 */
  spacer?: boolean
}

const props = defineProps<{
  items: MessageMenuItem[]
}>()

const emit = defineEmits<{
  select: [key: string]
  close: []
}>()

const gridItems = computed(() => props.items.filter((item) => !item.wide))
const wideItems = computed(() => props.items.filter((item) => item.wide))

function onCellClick(item: MessageMenuItem) {
  if (item.spacer) return
  emit('select', item.key)
}
</script>

<template>
  <view class="mask" @click="emit('close')" @touchmove.stop.prevent>
    <view class="menu-wrap" @click.stop>
      <view class="menu-grid">
        <view
          v-for="item in gridItems"
          :key="item.key"
          class="cell"
          :class="{ spacer: item.spacer }"
          @click="onCellClick(item)"
        >
          <text v-if="!item.spacer">{{ item.label }}</text>
        </view>
      </view>
      <view v-if="wideItems.length" class="menu-wide">
        <view
          v-for="item in wideItems"
          :key="item.key"
          class="cell wide"
          @click="onCellClick(item)"
        >
          <text>{{ item.label }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 对齐参考站 qwa.11skrmx6.net 群聊长按菜单 */
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.45);
}

.menu-wrap {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 50vw;
  min-width: 240rpx;
  max-width: 320px;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 12px 32px rgba(15, 23, 42, 0.14),
    0 2px 8px rgba(15, 23, 42, 0.08);
}

.menu-grid {
  display: flex;
  flex-wrap: wrap;
}

.menu-wide {
  border-top: 1px solid #ececec;
}

.menu-grid .cell:nth-last-child(1),
.menu-grid .cell:nth-last-child(2) {
  border-bottom: none;
}

.cell {
  width: 50%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 20px;
  color: #1a1a1a;
  border-bottom: 1px solid #ececec;
  border-right: 1px solid #ececec;
  box-sizing: border-box;
  text-align: center;
}

.cell:nth-child(2n) {
  border-right: none;
}

.cell:active:not(.spacer) {
  background: #f0f1f4;
}

.cell.spacer {
  pointer-events: none;
}

.menu-wide .cell.wide {
  width: 100%;
  border-right: none;
  border-bottom: 1px solid #ececec;
}

.menu-wide .cell.wide:last-child {
  border-bottom: none;
}
</style>
