<script setup lang="ts">
defineProps<{
  active?: boolean
}>()

const emit = defineEmits<{
  start: [event: MouseEvent]
}>()

function onMouseDown(event: Event) {
  emit('start', event as MouseEvent)
}
</script>

<template>
  <view
    class="im-desktop-resizer"
    :class="{ active }"
    @mousedown.stop.prevent="onMouseDown"
  >
    <view class="im-desktop-resizer-handle" />
  </view>
</template>

<style scoped lang="scss">
.im-desktop-resizer {
  width: 8px;
  flex-shrink: 0;
  height: 100%;
  cursor: col-resize;
  position: relative;
  z-index: 12;
  background: #ececec;
  touch-action: none;
}

.im-desktop-resizer-handle {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 40px;
  border-radius: 2px;
  background: #8a8f9c;
  pointer-events: none;
  transition: background 0.15s ease, height 0.15s ease;
}

.im-desktop-resizer:hover .im-desktop-resizer-handle,
.im-desktop-resizer.active .im-desktop-resizer-handle {
  background: #636e86;
  height: 48px;
}
</style>
