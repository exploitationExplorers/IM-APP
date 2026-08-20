<script setup lang="ts">
import ConversationItem from '@/components/ConversationItem.vue'
import type { Conversation } from '@/types'

/**
 * 包装 uni-swipe-action-item：组合 <ConversationItem>，提供统一的 row 接口。
 *
 * 右侧按钮通过 #right 插槽注入。
 * 行点击由 ConversationItem 自身 emit('click', item) 转发为 item-click，
 * 而非依赖 uni-swipe-action-item 的 @click（它只在按钮区触发，且本组件用自定义插槽时永不触发）。
 * `show` 透传 uni-ui 字符串语义 'left'/'right'/'none'，父组件据此追踪哪个 row 展开。
 * `change` 事件透传 uni-swipe-action-item 的展开/收起状态变化，父组件用于同步 activeSwipeId。
 */

defineProps<{
  item: Conversation
  show: string
}>()

const emit = defineEmits<{
  (e: 'item-click', item: Conversation): void
  (e: 'change', open: string): void
}>()

function onItemClick(item: Conversation) {
  emit('item-click', item)
}

function onChange(open: string) {
  emit('change', open)
}
</script>

<template>
  <uni-swipe-action-item :show="show" @change="onChange">
    <ConversationItem :item="item" @click="onItemClick" />
    <template #right>
      <view class="swipe-btn-wrap">
        <slot name="right" />
      </view>
    </template>
  </uni-swipe-action-item>
</template>

<style scoped lang="scss">
.swipe-btn-wrap {
  height: 100%;
  display: flex;
  flex-direction: row;
}
</style>
