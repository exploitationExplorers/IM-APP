<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { MessageMenuItem } from '@/composables/chatMessageActions/types'

const props = defineProps<{
  items: MessageMenuItem[]
  /** 长按/右键锚点；缺省居中（兼容旧调用） */
  x?: number | null
  y?: number | null
}>()

const emit = defineEmits<{
  select: [key: string]
  close: []
}>()

/** wide 项只走底部通栏，不能再进网格，否则同一动作会出现两次 */
const gridItems = computed(() => props.items.filter((item) => !item.wide))
const wideItems = computed(() => props.items.filter((item) => item.wide && !item.spacer))
const menuRef = ref<HTMLElement | null>(null)
const anchoredStyle = ref<Record<string, string>>({})

const hasAnchor = computed(
  () => Number.isFinite(props.x) && Number.isFinite(props.y) && (props.x as number) > 0 && (props.y as number) > 0,
)

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function updatePosition() {
  if (!hasAnchor.value) {
    anchoredStyle.value = {}
    return
  }
  const sys = uni.getSystemInfoSync()
  const vw = sys.windowWidth || 375
  const vh = sys.windowHeight || 667
  const el = menuRef.value as unknown as { offsetWidth?: number; offsetHeight?: number } | null
  const mw = el?.offsetWidth || 260
  const mh = el?.offsetHeight || 220
  const pad = 8
  // 默认出现在手指/鼠标下方偏右；贴边时夹紧
  let left = (props.x as number) - mw / 2
  let top = (props.y as number) + 12
  left = clamp(left, pad, vw - mw - pad)
  if (top + mh + pad > vh) {
    top = clamp((props.y as number) - mh - 12, pad, vh - mh - pad)
  } else {
    top = clamp(top, pad, vh - mh - pad)
  }
  anchoredStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    transform: 'none',
  }
}

onMounted(() => {
  void nextTick(() => updatePosition())
})

watch(
  () => [props.x, props.y, props.items.length] as const,
  () => {
    void nextTick(() => updatePosition())
  },
)

function onCellClick(item: MessageMenuItem) {
  if (item.spacer) return
  emit('select', item.key)
}
</script>

<template>
  <view
    class="mask"
    @click="emit('close')"
    @touchmove.stop.prevent
  >
    <view
      class="menu-wrap"
      :class="{ anchored: hasAnchor }"
      :style="anchoredStyle"
      @click.stop
    >
      <view
        ref="menuRef"
        class="menu-grid"
      >
        <view
          v-for="item in gridItems"
          :key="item.key"
          class="cell"
          :class="{ spacer: item.spacer }"
          @click="onCellClick(item)"
        >
          <text v-if="!item.spacer">
            {{ item.label }}
          </text>
        </view>
      </view>
      <view
        v-if="wideItems.length"
        class="menu-wide"
      >
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

.menu-wrap.anchored {
  /* left/top 由内联 style 控制 */
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

.cell.wide {
  width: 100%;
  border-right: none;
  min-height: 48px;
  font-weight: 600;
}
</style>
